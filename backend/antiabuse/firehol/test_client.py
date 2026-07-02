"""
Tests for antiabuse.firehol – the HTTP client that talks to the FireHOL
container. A tiny stub HTTP server stands in for the real container so these
tests touch neither the network nor a subprocess.
"""

import asyncio
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from antiabuse.firehol import FireholClient


class _StubServer(ThreadingHTTPServer):
    matches_for: dict[str | None, list[str]]


class _StubHandler(BaseHTTPRequestHandler):
    # Set per-test on the server instance.
    def _json(self, status: int, payload: object) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/matches":
            ip = parse_qs(parsed.query).get("ip", [None])[0]
            matches_for = getattr(self.server, "matches_for", {})
            self._json(200, matches_for.get(ip, []))
        else:
            self._json(404, {"error": "not found"})

    def log_message(self, *args: object) -> None:
        pass


class FireholClientTests(unittest.TestCase):
    def setUp(self) -> None:
        server = _StubServer(("127.0.0.1", 0), _StubHandler)
        server.matches_for = {"1.2.3.4": ["list_a", "list_b"]}
        self.server = server
        self._thread = threading.Thread(target=server.serve_forever, daemon=True)
        self._thread.start()
        host, port = server.server_address[:2]
        if isinstance(host, bytes):
            host = host.decode()
        self.client = FireholClient(f"http://{host}:{port}")

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def test_matches_hit(self) -> None:
        self.assertEqual(
            sorted(asyncio.run(self.client.matches("1.2.3.4"))),
            ["list_a", "list_b"],
        )

    def test_matches_miss(self) -> None:
        self.assertEqual(asyncio.run(self.client.matches("5.5.5.5")), [])


class FireholClientFailOpenTests(unittest.TestCase):
    """A down/unreachable container must look like "not blocked"."""

    def setUp(self) -> None:
        # Port 1 is reserved and never listening, so connections are refused.
        self.client = FireholClient("http://127.0.0.1:1")

    def test_matches_fails_open(self) -> None:
        self.assertEqual(asyncio.run(self.client.matches("1.2.3.4")), [])


if __name__ == "__main__":
    unittest.main()
