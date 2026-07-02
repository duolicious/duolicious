"""
Factory for the `httpx.AsyncClient` used across the async (FastAPI API / cron)
side of the codebase.

Every outbound HTTP call wants the same baseline policy -- a bounded timeout so
a slow or unreachable peer can't stall the event loop indefinitely, and
redirect-following to match the `urllib` behaviour these calls replaced. Rather
than copy-paste (and let drift) `timeout=`/`follow_redirects=` across `notify`,
`verification`, `antiabuse.firehol`, ... the policy lives here once.

Callers that need a different bound pass `timeout=` (e.g. the FireHOL client's
aggressive fail-open timeout); any keyword overrides the default.

This mirrors `redisclient`, and is intentionally separate from the chat
service, which constructs its own clients.
"""

import os

import httpx

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
