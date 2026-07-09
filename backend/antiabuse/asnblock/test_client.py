"""
Tests for antiabuse.asnblock – the RIPEstat client and ASN blocklist that gate
new sign-ups. A tiny stub HTTP server stands in for RIPEstat so these tests
touch neither the network nor a subprocess.
"""

import asyncio
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from antiabuse.asnblock import BLOCKED_ASNS, RipeClient, blocked


def _network_info(asns: list[str], prefix: str) -> dict:
    """The subset of RIPEstat's network-info response shape that we consume."""
    return {
        "status": "ok",
        "data": {
            "asns": asns,
            "prefix": prefix,
        },
    }


class _StubServer(ThreadingHTTPServer):
    responses_for: dict[str | None, object]


class _StubHandler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: object) -> None:
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
        self.assertEqual(asyncio.run(self.client.asns("8.8.8.8")), ["15169"])

    def test_asns_multiple(self) -> None:
        self.assertEqual(
            sorted(asyncio.run(self.client.asns("1.2.3.4"))),
            ["16247", "9009"],
        )

    def test_asns_miss(self) -> None:
        self.assertEqual(asyncio.run(self.client.asns("9.9.9.9")), [])

    def test_asns_malformed_response_fails_open(self) -> None:
        self.assertEqual(asyncio.run(self.client.asns("5.5.5.5")), [])


class RipeClientFailOpenTests(unittest.TestCase):
    """A down/unreachable RIPEstat must look like "not blocked"."""

    def setUp(self) -> None:
        # Port 1 is reserved and never listening, so connections are refused.
        self.client = RipeClient("http://127.0.0.1:1")

    def test_asns_fails_open(self) -> None:
        self.assertEqual(asyncio.run(self.client.asns("1.2.3.4")), [])


class BlocklistTests(unittest.TestCase):
    def test_blocklist_contents(self) -> None:
        # The ASNs from https://github.com/duolicious/duolicious/issues/1288.
        self.assertEqual(
            BLOCKED_ASNS,
            frozenset([
                "9009",    # M247 Europe SRL
                "16247",   # M247 Ltd
                "42973",   # M247 Ltd
                "60068",   # Datacamp Limited
                "206092",  # Datacamp Limited
                "211612",  # Datacamp Limited
                "212238",  # Datacamp Limited
            ]),
        )

    def test_blocked(self) -> None:
        self.assertTrue(blocked(["16247"]))
        self.assertTrue(blocked(["15169", "9009"]))
        self.assertFalse(blocked(["15169"]))
        self.assertFalse(blocked([]))


if __name__ == "__main__":
    unittest.main()
