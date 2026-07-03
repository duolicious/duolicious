"""Test-only overrides toggled by files under `test/input/`.

The functionality test suite drops sentinel files here to force otherwise
non-deterministic behaviour: bypass rate limits, or pin the client IP. All of
these are inert unless `enable-mocking` is present, so they can never loosen
anything in production.
"""

import time
from functools import lru_cache
from pathlib import Path

from starlette.requests import Request

_input_dir = Path(__file__).parent.parent.parent / 'test' / 'input'

enable_mocking_file = _input_dir / 'enable-mocking'
disable_ip_rate_limit_file = _input_dir / 'disable-ip-rate-limit'
disable_account_rate_limit_file = _input_dir / 'disable-account-rate-limit'
mock_ip_address_file = _input_dir / 'mock-ip-address'


def _file_says_enabled(path: Path) -> bool:
    if not path.is_file():
        return False
    with path.open() as file:
        return file.read().strip() == '1'


@lru_cache()
def _enable_mocking(ttl_hash: int | None = None) -> bool:
    return _file_says_enabled(enable_mocking_file)


def enable_mocking() -> bool:
    # `ttl_hash` buckets the cache into ~1s windows so a freshly-dropped
    # sentinel takes effect promptly without re-reading the file every call.
    return _enable_mocking(ttl_hash=round(time.time()))


# `request` is accepted (and ignored) so these match the uniform
# `exempt_when(request)` signature the rate limiter calls them with.
def disable_ip_rate_limit(request: Request | None = None) -> bool:
    return enable_mocking() and _file_says_enabled(disable_ip_rate_limit_file)


def disable_account_rate_limit(request: Request | None = None) -> bool:
    return enable_mocking() and _file_says_enabled(disable_account_rate_limit_file)


def mock_ip_address() -> str | None:
    if not enable_mocking() or not mock_ip_address_file.is_file():
        return None
    with mock_ip_address_file.open() as file:
        return file.read().strip() or None
