"""
Best-effort ASN blocking for new sign-ups.

Resolves the ASN(s) that announce a client's IP address via RIPEstat's
network-info endpoint and checks them against a small JSON blocklist
(`blocked-asns.json`, a list of ASNs) of VPN / hosting providers whose
addresses are a recurring source of abuse.

Like `antiabuse.anonymizers.firehol`, lookups fail open: any timeout,
connection error, or malformed response yields no ASNs, i.e. "not blocked". A
typical RIPEstat lookup takes ~0.3 s from the server, so the default timeout
adds only a small margin on top of that; if RIPEstat is slower, we just let
the user sign up.
"""

import ipaddress
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Union
from urllib.parse import quote

import httpx

from httpxclient import make_http_client
from util import timed

Asn = str
IPAddress = Union[str, ipaddress.IPv4Address, ipaddress.IPv6Address]

RIPE_URL = os.environ.get("DUO_RIPE_URL", "https://stat.ripe.net")

RIPE_TIMEOUT = float(os.environ.get("DUO_RIPE_TIMEOUT", "0.5"))

# A JSON list of ASNs as bare numbers; RIPEstat reports ASNs as digit strings,
# so they're normalized to strings here.
_blocked_asns_file = Path(__file__).parent / "blocked-asns.json"

BLOCKED_ASNS: frozenset[Asn] = frozenset(
    str(asn)
    for asn in json.loads(_blocked_asns_file.read_text(encoding="utf-8"))
)


def _log(message: str) -> None:
    print(f"{datetime.now(timezone.utc).isoformat()} {message}")


class RipeClient:
    """Look up the ASN(s) announcing an IP address via RIPEstat."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    async def asns(self, ip: IPAddress) -> list[Asn]:
        """Return the ASNs announcing `ip` (or [] on any failure)."""
        url = (
            f"{self.base_url}/data/network-info/data.json"
            f"?resource={quote(str(ip))}"
        )
        with timed("RIPEstat request", _log):
            try:
                async with make_http_client(timeout=RIPE_TIMEOUT) as client:
                    resp = await client.get(url)
                if resp.status_code != 200:
                    return []
                response = resp.json()
            except httpx.TimeoutException:
                _log(f"RIPEstat request timed out, failing open: {url}")
                return []
            except (httpx.HTTPError, ValueError) as e:
                _log(f"RIPEstat request failed, failing open ({url}): {e}")
                return []

        if not isinstance(response, dict):
            return []
        data = response.get("data")
        if not isinstance(data, dict):
            return []
        asns = data.get("asns")
        if not isinstance(asns, list):
            return []
        return [str(asn) for asn in asns if isinstance(asn, (str, int))]


def blocked_asns(asns: Iterable[Asn]) -> list[Asn]:
    """The subset of `asns` that is on the blocklist."""
    return [asn for asn in asns if asn in BLOCKED_ASNS]


# ---------------------------------------------------------------------------
# Convenience singleton
# ---------------------------------------------------------------------------

ripe = RipeClient(RIPE_URL)
