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
from dataclasses import dataclass

from antiabuse.anonymizers import asnblock
from antiabuse.anonymizers.firehol import firehol as firehol_client
from util import IPAddress, log


@dataclass(frozen=True)
class AnonymizerCheck:
    blocked: bool

    # Recorded on new sign-ups' sessions for abuse analysis; None means the
    # lookup failed, [] an address that announces no ASN.
    asns: list[int] | None


async def check(ip: IPAddress) -> AnonymizerCheck:
    """Check `ip` against the FireHOL lists and the ASN blocklist in parallel,
    logging the reason for any block."""
    firehol_lists, asns = await asyncio.gather(
        firehol_client.matches(ip),
        asnblock.ripe.asns(ip),
    )

    blocked_asns = asnblock.blocked_asns(asns or [])

    reasons = []
    if firehol_lists:
        reasons.append(f"FireHOL lists: {', '.join(sorted(firehol_lists))}")
    if blocked_asns:
        reasons.append(
            f"blocked ASNs: {', '.join(str(asn) for asn in blocked_asns)}")

    if reasons:
        log(f"Blocking sign-up from {ip} — {'; '.join(reasons)}")

    return AnonymizerCheck(blocked=bool(reasons), asns=asns)
