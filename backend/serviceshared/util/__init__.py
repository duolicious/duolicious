from datetime import datetime, timezone
from urllib.parse import quote
from typing import Callable, Iterator, TypeAlias, Union
import contextlib
import ipaddress
import logging
import os
import time

from serviceshared.duoenv.shared import OFFPEAK_FUNCTION_OVERRIDE

# `service.firehol` keeps its own copy: its container ships only service/firehol.
IPAddress = Union[str, ipaddress.IPv4Address, ipaddress.IPv6Address]

Json: TypeAlias = (
    None | bool | int | float | str | list['Json'] | dict[str, 'Json']
)


logger = logging.getLogger(__name__)


def log(message: str) -> None:
    logger.info(message)


@contextlib.contextmanager
def timed(label: str = 'block', log: Callable[[str], None] = log) -> Iterator[None]:
    """Context manager that logs how long the block took, even if it raises.

    `log` receives the formatted message.
    """
    start = time.monotonic()
    try:
        yield
    finally:
        log(f"{label} took {time.monotonic() - start:.4f}s")

def append_query(base: str, params: dict) -> str:
    sep = '&' if '?' in base else '?'
    encoded = '&'.join(
        f'{quote(k, safe="")}={quote(v, safe="")}'
        for k, v in params.items()
        if v is not None
    )
    return f'{base}{sep}{encoded}' if encoded else base


def human_readable_size_metric(size_bytes: float) -> str:
    # Define suffixes for metric prefixes
    suffixes = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB']
    i = 0
    while size_bytes >= 1000 and i < len(suffixes) - 1:
        size_bytes /= 1000.0
        i += 1
    return f"{size_bytes:.1f} {suffixes[i]}"


def truncate_text(
    text: str,
    max_chars: int = 300,
    max_newlines: int = 20,
) -> str:
    ellipsis = "..."
    original = text

    # Truncate by `max_newlines`
    lines = text.splitlines()
    text = '\n'.join(lines[:max_newlines])

    # Truncate by `max_chars`
    text = text[:max_chars - len(ellipsis)]

    text = text.strip()

    # Add the ellipsis if needed
    text = text if text == original else text + ellipsis

    return text


def is_offpeak(max_load_pct: float = 75.0, suppressed_action: str = '') -> bool:
    if OFFPEAK_FUNCTION_OVERRIDE == 'true':
        return True
    elif OFFPEAK_FUNCTION_OVERRIDE == 'false':
        return False

    try:
        load_1min, load_5min, _ = os.getloadavg()
    except (OSError, AttributeError):
        return True

    ncpu = os.cpu_count() or 1
    pct_1min = load_1min / ncpu * 100
    pct_5min = load_5min / ncpu * 100

    _is_offpeak = pct_1min < max_load_pct and pct_5min < max_load_pct

    if _is_offpeak:
        return True

    logger.info(
        f'is_offpeak returned False '
        f'load 1m={pct_1min:.0f}%, 5m={pct_5min:.0f}% '
        f'(target < {max_load_pct:.0f}%)'
        + (f' suppressed ' + suppressed_action if suppressed_action else '')
    )

    return False
