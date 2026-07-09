"""
HTTP client for the FireHOL block-list lookup container.

Exposes the `matches()` surface the rest of the app relied on when `Firehol`
ran in-process, but forwards each call to the `firehol` container (see
service/firehol) so that the block-list tries are held in memory once rather
than once per API worker.

Lookups fail open: any timeout, connection error, or non-200 response yields an
empty list, i.e. "not blocked". The service itself does no timeout handling, so
timeouts are owned (and logged) here.
"""

import os
from urllib.parse import quote

from httpxclient import get_json_fail_open
from util import IPAddress

ListName = str

FIREHOL_URL = os.environ.get("DUO_FIREHOL_URL", "http://firehol:5070")

# Container-to-container lookups are fast, but we keep the timeout short so a
# slow or unavailable FireHOL container never stalls an auth request; we just
# fail open instead.
FIREHOL_TIMEOUT = float(os.environ.get("DUO_FIREHOL_TIMEOUT", "0.02"))


class FireholClient:
    """Check IP addresses against the FireHOL container over HTTP."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    async def matches(self, ip: IPAddress) -> list[ListName]:
        """Return the FireHOL lists the address belongs to (or [])."""
        response = await get_json_fail_open(
            f"{self.base_url}/matches?ip={quote(str(ip))}",
            timeout=FIREHOL_TIMEOUT,
            label="FireHOL request",
        )
        if not isinstance(response, list):
            return []
        return [name for name in response if isinstance(name, str)]


# ---------------------------------------------------------------------------
# Convenience singleton
# ---------------------------------------------------------------------------

firehol = FireholClient(FIREHOL_URL)
