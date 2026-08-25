import glob
import os
import pickle
from collections.abc import Callable
from typing import TypeVar

from kvmatching.evaluate import EvalData
from kvmatching.features import Features
from kvmatching.pairs import SPLIT
from kvmatching.paths import DATA

T = TypeVar("T")


def is_fresh(path: str) -> bool:
    """A cache is stale as soon as any extracted parquet is newer than it, so
    that re-running extract.py cannot leave training on old features."""
    if not os.path.exists(path):
        return False
    newest = max(os.path.getmtime(p) for p in glob.glob(os.path.join(DATA, "*.parquet")))
    return os.path.getmtime(path) >= newest


def _cached(path: str, build: Callable[[], T]) -> T:
    if is_fresh(path):
        with open(path, "rb") as fh:
            value: T = pickle.load(fh)
            return value
    value = build()
    with open(path, "wb") as fh:
        pickle.dump(value, fh, protocol=5)
    return value


def load_features() -> Features:
    return _cached(os.path.join(DATA, "features.pkl"), Features)


def load_evaldata(f: Features) -> EvalData:
    ed = _cached(os.path.join(DATA, f"evaldata_{SPLIT.date()}.pkl"),
                 lambda: EvalData(f))
    ed.f = f
    return ed
