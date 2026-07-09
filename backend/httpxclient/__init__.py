"""
Factory for the `httpx.AsyncClient` used across the async (FastAPI API / cron)
side of the codebase.

Every outbound HTTP call wants the same baseline policy -- a bounded timeout so
a slow or unreachable peer can't stall the event loop indefinitely, and
redirect-following to match the `urllib` behaviour these calls replaced. Rather
than copy-paste (and let drift) `timeout=`/`follow_redirects=` across `notify`,
`verification`, `antiabuse.anonymizers`, ... the policy lives here once.

Callers that need a different bound pass `timeout=` (e.g. the FireHOL client's
aggressive fail-open timeout); any keyword overrides the default.

Callers open a short-lived client per call (`async with make_http_client()`),
rather than sharing a long-lived module-level client as `redisclient` does. That
suits the low-frequency sites that use it (batched push, verification, the
FireHOL cron) and keeps the client from binding to an event loop at import time.
Like `redisclient`, this is intentionally separate from the chat service, which
constructs its own clients.
"""

import os

import httpx

from util import Json, log, timed

# Bounds every outbound request unless the caller overrides it. Keeps a slow or
# unreachable peer from blocking the event loop indefinitely.
HTTP_TIMEOUT: float = float(os.environ.get("DUO_HTTP_TIMEOUT", "30"))


def make_http_client(
    timeout: float | httpx.Timeout | None = HTTP_TIMEOUT,
    follow_redirects: bool = True,
) -> httpx.AsyncClient:
    """Return an `httpx.AsyncClient` with the shared default policy.

    Pass `timeout=` to override the default bound (e.g. the FireHOL client's
    aggressive fail-open timeout).
    """
    return httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=follow_redirects,
    )


async def get_json_fail_open(
    url: str,
    *,
    timeout: float,
    label: str,
) -> Json:
    """GET `url` and decode the JSON body; any failure is logged and yields
    None, so a slow or broken upstream never blocks the caller's request."""
    with timed(label, log):
        try:
            async with make_http_client(timeout=timeout) as client:
                resp = await client.get(url)
            if resp.status_code != 200:
                log(f"{label} returned HTTP {resp.status_code}, "
                    f"failing open: {url}")
                return None
            return resp.json()
        except httpx.TimeoutException:
            log(f"{label} timed out, failing open: {url}")
            return None
        except (httpx.HTTPError, ValueError) as e:
            log(f"{label} failed, failing open ({url}): {e}")
            return None
