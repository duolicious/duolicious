"""
FireHOL block-list service.

Runs in its own container (see firehol.Dockerfile) so the (large) pytricia tries
are held in memory once, rather than once per API worker. API workers reach it
over HTTP via `antiabuse.anonymizers.firehol` (the client), which fails open —
treating any error or timeout as "not blocked".

Because the client owns the timeout/fail-open policy and this service only sees
a few requests per minute, the service itself is deliberately simple: a single
process, a background thread that rebuilds the tries every few hours, and an
atomic swap of the active tries when a rebuild finishes. Two things can make a
lookup slow, and both are fine:

  * Start-up. The first build takes ~a minute to download and parse the lists;
    until it finishes `_tries` is None and every lookup reports "not blocked".
  * Refreshes. Rebuilding holds the GIL for CPU-bound work, which can briefly
    stall request handling. The old tries keep serving until the swap, and the
    client fails open for anything that does stall.

Prefix lookups are backed by `pytricia`, a C-implemented Patricia trie. Each
prefix maps to a `frozenset` of FireHOL list names that contain it, and
`_PrefixTrie.search()` walks the parent chain so that *every* covering prefix
contributes its list names (not just the longest match).

Run with `python3 service/firehol/__init__.py`. Endpoints:
    GET /matches?ip=<addr>  -> 200, JSON list of matching list names (or [])
    GET /ready              -> 200, {"ready": <bool>}
    GET /health             -> 200, "ok"
"""

import ipaddress
import json
import logging
import os
import threading
import time
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, Iterable, Tuple, Union
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

import pytricia

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

ListName = str
IPAddress = Union[str, ipaddress.IPv4Address, ipaddress.IPv6Address]
IPvXAddress = Union[ipaddress.IPv4Address, ipaddress.IPv6Address]

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

FIREHOL_PORT = int(os.environ.get("DUO_FIREHOL_PORT", "5070"))

DEFAULT_LISTS = [
    "firehol_anonymous.netset",
]

UPDATE_INTERVAL = timedelta(hours=4)

cache_dir = Path("/tmp/duolicious-firehol")
cache_dir.mkdir(parents=True, exist_ok=True)


logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s:     %(asctime)s %(name)s: %(message)s',
)

logger = logging.getLogger('firehol')


# ---------------------------------------------------------------------------
# Download / parse / build
# ---------------------------------------------------------------------------

def _blocklist_url(name: ListName) -> str:
    return f"https://iplists.firehol.org/files/{name}"


def _parse_blocklist(text: str) -> Tuple[list[str], list[str]]:
    """Convert raw *netset* text to IPv4 and IPv6 prefix-string lists."""
    v4: list[str] = []
    v6: list[str] = []

    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue

        try:
            net = ipaddress.ip_network(line, strict=False)
        except ValueError:
            continue

        if isinstance(net, ipaddress.IPv4Network):
            v4.append(net.with_prefixlen)
        elif isinstance(net, ipaddress.IPv6Network):
            v6.append(net.with_prefixlen)

    return v4, v6


def _download_or_load(name: ListName, update_interval: timedelta) -> str:
    """Return the raw list text, from the on-disk cache if it's still fresh."""
    path = cache_dir / name

    if path.exists():
        age = time.time() - path.stat().st_mtime
        if age < update_interval.total_seconds():
            logger.info(f"Loading {name} from disk cache")
            return path.read_text(encoding="utf-8", errors="ignore")

    url = _blocklist_url(name)
    logger.info(f"Downloading {url}")
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=30) as resp:
        text = resp.read().decode("utf-8", errors="ignore")
    logger.info(f"Finished downloading {url}")

    # Atomic write: write to tmp → replace
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)  # atomic on POSIX

    return text


class _PrefixTrie:
    """Thin wrapper that maps IP prefixes -> {list_name, ...}.

    pytricia stores at most one value per prefix, so when several FireHOL lists
    contain the same prefix we stash the union in a `frozenset`. `search()`
    walks the longest-match parent chain so every covering prefix contributes
    its list names.
    """

    def __init__(self, max_prefixlen: int) -> None:
        self._pyt = pytricia.PyTricia(max_prefixlen)

    def insert(self, prefix: str, list_name: ListName) -> None:
        existing = self._pyt.get(prefix)
        if existing is None:
            self._pyt[prefix] = frozenset((list_name,))
        elif list_name not in existing:
            self._pyt[prefix] = existing | {list_name}

    def search(self, addr: IPvXAddress) -> list[ListName]:
        addr_str = str(addr)
        try:
            key = self._pyt.get_key(addr_str)
        except (KeyError, ValueError):
            return []
        if key is None:
            return []

        found: set[ListName] = set()
        while key is not None:
            value = self._pyt.get(key)
            if value:
                found.update(value)
            key = self._pyt.parent(key)
        return list(found)


def _collect_all(
    lists: Iterable[ListName],
    update_interval: timedelta,
) -> Dict[ListName, Tuple[list[str], list[str]]]:
    """Download / load every configured list, return dict(name → prefixes)."""
    fresh: Dict[ListName, Tuple[list[str], list[str]]] = {}

    for name in lists:
        raw = _download_or_load(name, update_interval)
        v4, v6 = _parse_blocklist(raw)
        if not v4 and not v6:
            raise ValueError(f"FireHOL list '{name}' appears to be empty.")
        fresh[name] = (v4, v6)

    return fresh


def _build_tries(
    data: Dict[ListName, Tuple[list[str], list[str]]],
) -> tuple[_PrefixTrie, _PrefixTrie]:
    v4_trie = _PrefixTrie(32)
    v6_trie = _PrefixTrie(128)
    for name, (v4, v6) in data.items():
        for prefix in v4:
            v4_trie.insert(prefix, name)
        for prefix in v6:
            v6_trie.insert(prefix, name)
    return v4_trie, v6_trie


# ---------------------------------------------------------------------------
# Active tries + background refresher
# ---------------------------------------------------------------------------

# Swapped in atomically (a single reference assignment) by the refresher when a
# rebuild finishes. `None` until the first build completes, during which lookups
# report "not blocked".
_tries: "tuple[_PrefixTrie, _PrefixTrie] | None" = None


def lookup(ip: IPAddress) -> list[ListName]:
    """Return the FireHOL lists `ip` belongs to (or [] if none / not loaded)."""
    tries = _tries
    if tries is None:
        return []
    addr = ipaddress.ip_address(str(ip))
    v4_trie, v6_trie = tries
    trie = v4_trie if addr.version == 4 else v6_trie
    return trie.search(addr)


def _refresh_forever() -> None:
    global _tries
    while True:
        try:
            data = _collect_all(DEFAULT_LISTS, UPDATE_INTERVAL)
            _tries = _build_tries(data)  # atomic swap
            logger.info("FireHOL lists loaded")
        except Exception:
            logger.exception("FireHOL refresh failed")
        time.sleep(UPDATE_INTERVAL.total_seconds())


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

class _Handler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: object) -> None:
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
            if not ip:
                self._send_json(400, {"error": "missing ip"})
                return
            lists = lookup(ip)
            if lists:
                logger.info(f"lookup {ip} -> BLOCKED by {', '.join(sorted(lists))}")
            else:
                logger.info(f"lookup {ip} -> ACCEPTED")
            self._send_json(200, lists)
        elif parsed.path == "/ready":
            self._send_json(200, {"ready": _tries is not None})
        elif parsed.path == "/health":
            self._send_json(200, "ok")
        else:
            self._send_json(404, {"error": "not found"})

    # Quieten the default per-request stderr logging; we do our own above.
    def log_message(self, *args: object) -> None:
        pass


def main() -> None:
    threading.Thread(target=_refresh_forever, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", FIREHOL_PORT), _Handler)
    logger.info(f"FireHOL server listening on 0.0.0.0:{FIREHOL_PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
