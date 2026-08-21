from __future__ import annotations

import traceback
from multiprocessing import get_context
from typing import Callable, NoReturn, ParamSpec, Protocol, TypeVar

_P = ParamSpec("_P")
_R = TypeVar("_R")

class WorkerTarget(Protocol):
    def __call__(self, *args: object, **kwargs: object) -> object:
        ...


class SendConnection(Protocol):
    def send(self, obj: object) -> None:
        ...

    def close(self) -> None:
        ...


_GRACE = 2.0  # seconds to wait after terminate/kill


def _send_ignore_broken(conn: SendConnection, obj: object) -> None:
    """Send, ignoring BrokenPipe when parent already went away."""
    try:
        conn.send(obj)
    except (BrokenPipeError, OSError):
        pass


def _worker(
    conn: SendConnection,
    target: WorkerTarget,
    args: tuple[object, ...],
    kwargs: dict[str, object],
) -> None:
    try:
        _send_ignore_broken(conn, (True, target(*args, **kwargs)))
    except BaseException as exc:  # noqa: BLE001 – will be re‑raised
        te = traceback.TracebackException.from_exception(exc, capture_locals=True)
        _send_ignore_broken(conn, (False, (type(exc), exc.args, te)))
    finally:
        conn.close()


def run_with_timeout(
    seconds: float,
    target: Callable[_P, _R],
    /,
    *args: _P.args,
    **kwargs: _P.kwargs,
) -> _R:
    """
    Run ``target(*args, **kwargs)`` in a separate process.

    • Returns result if it finishes within *seconds*.
    • Propagates exceptions with original traceback.
    • Raises :class:`TimeoutError` if the limit is exceeded and guarantees
      the child is force‑killed so it no longer consumes CPU.
    """
    if seconds <= 0:
        raise ValueError("seconds must be > 0")

    ctx = get_context("spawn")  # safest default
    parent, child = ctx.Pipe(duplex=False)

    proc = ctx.Process(target=_worker, args=(child, target, args, kwargs))
    proc.start()
    child.close()  # parent keeps only one end

    try:
        if not parent.poll(seconds):
            proc.terminate()
            proc.join(_GRACE)
            if proc.is_alive():
                getattr(proc, "kill", proc.terminate)()
            raise TimeoutError(f"{target.__name__} exceeded {seconds} s")

        ok, payload = parent.recv()
    finally:
        parent.close()
        proc.join(_GRACE)

    if not ok:                                     # child raised
        exctype, excargs, te = payload
        raise exctype(*excargs).with_traceback(te.as_traceback())

    return payload  # type: ignore[return-value]
