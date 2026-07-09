"""
Tests for antiabuse.anonymizers – the combined anonymizer check. The FireHOL
and RIPEstat clients are mocked out, so these tests only cover the composition:
running both blockers, deciding `blocked`, and logging why a block happened.
"""

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import antiabuse.anonymizers as anonymizers


def _check(
    firehol_lists: list[str],
    asns: list[int] | None,
) -> tuple[anonymizers.AnonymizerCheck, list[str]]:
    """Run `check("1.2.3.4")` with mocked blockers, returning the result and
    whatever was logged."""
    logged: list[str] = []
    with (
        patch.object(
            anonymizers.firehol_client,
            "matches",
            AsyncMock(return_value=firehol_lists),
        ),
        patch.object(
            anonymizers.asnblock.ripe,
            "asns",
            AsyncMock(return_value=asns),
        ),
        patch.object(anonymizers, "log", logged.append),
    ):
        result = asyncio.run(anonymizers.check("1.2.3.4"))
    return result, logged


class CheckTests(unittest.TestCase):
    def test_not_blocked(self) -> None:
        result, logged = _check(firehol_lists=[], asns=[15169])
        self.assertEqual(
            result,
            anonymizers.AnonymizerCheck(blocked=False, asns=[15169]),
        )
        self.assertEqual(logged, [])

    def test_failed_asn_lookup_not_blocked(self) -> None:
        result, logged = _check(firehol_lists=[], asns=None)
        self.assertEqual(
            result,
            anonymizers.AnonymizerCheck(blocked=False, asns=None),
        )
        self.assertEqual(logged, [])

    def test_blocked_by_firehol(self) -> None:
        result, logged = _check(
            firehol_lists=["firehol_anonymous.netset"],
            asns=[15169],
        )
        self.assertTrue(result.blocked)
        self.assertEqual(result.asns, [15169])
        self.assertEqual(logged, [
            "Blocking sign-up from 1.2.3.4 — "
            "FireHOL lists: firehol_anonymous.netset",
        ])

    def test_blocked_by_asn(self) -> None:
        result, logged = _check(firehol_lists=[], asns=[16247])
        self.assertTrue(result.blocked)
        self.assertEqual(logged, [
            "Blocking sign-up from 1.2.3.4 — blocked ASNs: 16247",
        ])

    def test_blocked_by_both(self) -> None:
        result, logged = _check(
            firehol_lists=["firehol_anonymous.netset"],
            asns=[9009, 16247],
        )
        self.assertTrue(result.blocked)
        self.assertEqual(logged, [
            "Blocking sign-up from 1.2.3.4 — "
            "FireHOL lists: firehol_anonymous.netset; "
            "blocked ASNs: 9009, 16247",
        ])


if __name__ == "__main__":
    unittest.main()
