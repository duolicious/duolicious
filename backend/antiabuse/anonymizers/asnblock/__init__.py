"""
Best-effort ASN blocking for new sign-ups.

Resolves the ASN(s) that announce a client's IP address via RIPEstat's
network-info endpoint and checks them against a small JSON blocklist
(`blocked-asns.json`, a list of ASNs) of VPN / hosting providers whose
addresses are a recurring source of abuse.

ASNs are 32-bit unsigned integers and are handled as `int` throughout;
RIPEstat reports them as digit strings, which the client parses (dropping
anything non-numeric) at that boundary.

Like `antiabuse.anonymizers.firehol`, lookups fail open: any failure yields
None, i.e. "not blocked", kept distinct from [] so `duo_session.asns` can
tell an outage from an unrouted address. Each lookup opens a fresh connection
to RIPEstat, so the default timeout leaves room for the TLS handshake; if
RIPEstat is slower than that, we just let the user sign up.
"""

import json
import os
from pathlib import Path
from typing import Iterable
from urllib.parse import quote

from httpxclient import get_json_fail_open
from util import IPAddress

RIPE_URL = os.environ.get("DUO_RIPE_URL", "https://stat.ripe.net")

RIPE_TIMEOUT = float(os.environ.get("DUO_RIPE_TIMEOUT", "3"))

# A JSON list of ASNs as bare numbers.
_blocked_asns_file = Path(__file__).parent / "blocked-asns.json"

BLOCKED_ASNS: frozenset[int] = frozenset(
    json.loads(_blocked_asns_file.read_text(encoding="utf-8"))
)


class RipeClient:
    """Look up the ASN(s) announcing an IP address via RIPEstat."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    async def asns(self, ip: IPAddress) -> list[int] | None:
        """Return the ASNs announcing `ip`, or None if the lookup failed."""
        response = await get_json_fail_open(
            f"{self.base_url}/data/network-info/data.json"
            f"?resource={quote(str(ip))}",
            timeout=RIPE_TIMEOUT,
            label="RIPEstat request",
        )

        if not isinstance(response, dict):
            return None
        data = response.get("data")
        if not isinstance(data, dict):
            return None
        asns = data.get("asns")
        if not isinstance(asns, list):
            return None

        # RIPEstat reports ASNs as digit strings; drop anything else rather
        # than letting one odd entry fail the whole lookup.
        return [
            int(asn)
            for asn in asns
            if isinstance(asn, (str, int)) and str(asn).isdigit()
        ]


def blocked_asns(asns: Iterable[int]) -> list[int]:
    """The subset of `asns` that is on the blocklist."""
    return [asn for asn in asns if asn in BLOCKED_ASNS]


# ---------------------------------------------------------------------------
# Convenience singleton
# ---------------------------------------------------------------------------

ripe = RipeClient(RIPE_URL)
