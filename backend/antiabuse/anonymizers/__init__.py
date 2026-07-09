"""
Anonymizer (VPN / proxy / Tor / hosting) detection for new sign-ups.

Bundles the two anonymizer blockers — the FireHOL block-list client
(`antiabuse.anonymizers.firehol`) and the ASN blocker
(`antiabuse.anonymizers.asnblock`) — behind a single `check()` that runs both
lookups in parallel and logs which blocker matched, and why, together with the
IP address.

Both blockers fail open, so checking is best-effort: a slow or unavailable
FireHOL container or RIPEstat never blocks a sign-up.
"""

import asyncio
import ipaddress
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Union

from antiabuse.anonymizers import asnblock
from antiabuse.anonymizers.firehol import firehol as firehol_client

IPAddress = Union[str, ipaddress.IPv4Address, ipaddress.IPv6Address]


def _log(message: str) -> None:
    print(f"{datetime.now(timezone.utc).isoformat()} {message}")


@dataclass(frozen=True)
class AnonymizerCheck:
    blocked: bool

    # Whatever RIPEstat reported for the address, blocked or not; recorded on
    # new sign-ups' sessions so patterns of abuse can be analysed.
    asns: list[asnblock.Asn]


async def check(ip: IPAddress) -> AnonymizerCheck:
    """Check `ip` against the FireHOL lists and the ASN blocklist in parallel,
    logging the reason for any block."""
    firehol_lists, asns = await asyncio.gather(
        firehol_client.matches(ip),
        asnblock.ripe.asns(ip),
    )

    blocked_asns = asnblock.blocked_asns(asns)

    reasons = [
        reason
        for reason in [
            f"FireHOL lists: {', '.join(sorted(firehol_lists))}"
                if firehol_lists else None,
            f"blocked ASNs: {', '.join(blocked_asns)}"
                if blocked_asns else None,
        ]
        if reason
    ]

    if reasons:
        _log(f"Blocking sign-up from {ip} — {'; '.join(reasons)}")

    return AnonymizerCheck(blocked=bool(reasons), asns=asns)
