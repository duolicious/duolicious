"""
Tests for antiabuse.anonymizers.asnblock – the RIPEstat client and ASN
blocklist that gate new sign-ups. A tiny stub HTTP server stands in for
RIPEstat so these tests touch neither the network nor a subprocess.
"""

import asyncio
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from serviceshared.antiabuse.anonymizers.asnblock import (
    BLOCKED_ASNS,
    RipeClient,
    blocked_asns,
)
from serviceshared.util import Json


def _network_info(asns: list[Json], prefix: str) -> Json:
    """The subset of RIPEstat's network-info response shape that we consume."""
    return {
        "status": "ok",
        "data": {
            "asns": asns,
            "prefix": prefix,
        },
    }


class _StubServer(ThreadingHTTPServer):
    responses_for: dict[str | None, Json]


class _StubHandler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: Json) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/data/network-info/data.json":
            resource = parse_qs(parsed.query).get("resource", [None])[0]
            responses_for = getattr(self.server, "responses_for", {})
            if resource in responses_for:
                self._json(200, responses_for[resource])
            else:
                self._json(200, _network_info([], "0.0.0.0/0"))
        else:
            self._json(404, {"error": "not found"})

    def log_message(self, *args: object) -> None:
        pass


class RipeClientTests(unittest.TestCase):
    def setUp(self) -> None:
        server = _StubServer(("127.0.0.1", 0), _StubHandler)
        server.responses_for = {
            "8.8.8.8": _network_info(["15169"], "8.8.8.0/24"),
            "1.2.3.4": _network_info(["16247", "9009"], "1.2.3.0/24"),
            "5.5.5.5": {"status": "ok", "data": "malformed"},
            "6.6.6.6": _network_info(["not-a-number", "15169"], "6.6.6.0/24"),
        }
        self.server = server
        self._thread = threading.Thread(target=server.serve_forever, daemon=True)
        self._thread.start()
        host, port = server.server_address[:2]
        if isinstance(host, bytes):
            host = host.decode()
        self.client = RipeClient(f"http://{host}:{port}")

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def test_asns_hit(self) -> None:
        self.assertEqual(asyncio.run(self.client.asns("8.8.8.8")), [15169])

    def test_asns_multiple(self) -> None:
        asns = asyncio.run(self.client.asns("1.2.3.4"))
        assert asns is not None
        self.assertEqual(sorted(asns), [9009, 16247])

    def test_asns_miss(self) -> None:
        self.assertEqual(asyncio.run(self.client.asns("9.9.9.9")), [])

    def test_asns_malformed_response_fails_open(self) -> None:
        self.assertIsNone(asyncio.run(self.client.asns("5.5.5.5")))

    def test_asns_non_numeric_entries_dropped(self) -> None:
        self.assertEqual(asyncio.run(self.client.asns("6.6.6.6")), [15169])


class RipeClientFailOpenTests(unittest.TestCase):
    """A down/unreachable RIPEstat must look like "not blocked"."""

    def setUp(self) -> None:
        # Port 1 is reserved and never listening, so connections are refused.
        self.client = RipeClient("http://127.0.0.1:1")

    def test_asns_fails_open(self) -> None:
        self.assertIsNone(asyncio.run(self.client.asns("1.2.3.4")))


class BlocklistTests(unittest.TestCase):
    def test_blocklist_is_sane(self) -> None:
        self.assertTrue(BLOCKED_ASNS)
        self.assertTrue(all(isinstance(asn, int) for asn in BLOCKED_ASNS))
        self.assertTrue(all(asn > 0 for asn in BLOCKED_ASNS))
        # A known-blocked anchor (AWS), so an accidentally-emptied file fails.
        self.assertIn(16509, BLOCKED_ASNS)

    def test_blocked_asns(self) -> None:
        self.assertEqual(blocked_asns([16247]), [16247])
        self.assertEqual(blocked_asns([7018, 9009]), [9009])
        self.assertEqual(blocked_asns([7018]), [])
        self.assertEqual(blocked_asns([]), [])


if __name__ == "__main__":
    unittest.main()
