"""
Web Push (RFC 8291 / VAPID) sender, the web-only counterpart to `notify` (which
targets Expo/mobile). Each browser subscription has its own push-service
endpoint, so -- unlike `notify`'s single Expo endpoint -- there's nothing to
batch; sends are fire-and-forget tasks.

Delivery is best-effort and self-healing: a subscription the push service
reports as permanently gone (404/410) is cleared via the caller-supplied
`on_gone` hook, which owns the `duo_session` row (`maybewebpush`). Callers read
subscriptions through a short-lived cache (`fetch_web_push_subscriptions`), so a
just-cleared subscription can still be retried until that cache expires, after
which it's gone for good. The `webpush` package only encrypts the payload and
builds the VAPID headers (pure crypto, no I/O); the HTTP POST is ours, sent on
the shared async `httpx` client, so nothing blocks the event loop.

The push endpoint is client-supplied, so every send is guarded against SSRF: it
must be `https://`, its host is resolved and rejected unless every resolved
address is a public IP, the connection is pinned to that validated address
(defeating DNS rebinding) while still verifying TLS against the original
hostname, and redirects are not followed (so a 3xx can't bounce the request to
an internal host).

`DUO_VAPID_PRIVATE_KEY` (base64url-encoded raw P-256 private key) and
`DUO_VAPID_SUBJECT` (a `mailto:` contact) must be set for any push to be sent;
when the private key is absent or unusable, `enqueue_web_push` is a no-op.
"""
import asyncio
import base64
import ipaddress
import json
import socket
from typing import Awaitable, Callable
from urllib.parse import urlparse
import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pydantic import ValidationError
from webpush import (
    WebPush,
    WebPushException,
    WebPushMessage,
    WebPushSubscription,
)
from serviceshared.httpxclient import make_http_client
from serviceshared.util import Json, log

from serviceshared.duoenv.api import VAPID_PRIVATE_KEY, VAPID_SUBJECT

WEB_PUSH_TTL_SECONDS = 60

_tasks: set[asyncio.Task] = set()


def _load_web_push() -> WebPush | None:
    private_key = VAPID_PRIVATE_KEY

    if not private_key:
        return None

    try:
        raw = base64.urlsafe_b64decode(
            private_key + '=' * (-len(private_key) % 4))
        ec_key = ec.derive_private_key(
            int.from_bytes(raw, 'big'), ec.SECP256R1())
        private_pem = ec_key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption())
        public_pem = ec_key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo)
    except (ValueError, TypeError) as e:
        log(f'Web push disabled: DUO_VAPID_PRIVATE_KEY is unusable: {e}')
        return None

    return WebPush(
        private_key=private_pem,
        public_key=public_pem,
        subscriber=VAPID_SUBJECT.removeprefix('mailto:'),
        ttl=WEB_PUSH_TTL_SECONDS)


_web_push = _load_web_push()


def _is_public_ip(ip: str) -> bool:
    address = ipaddress.ip_address(ip)
    return not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified)


async def _resolve_pinned_ip(host: str, port: int) -> str | None:
    loop = asyncio.get_running_loop()

    try:
        infos = await loop.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return None

    ips = [str(info[4][0]) for info in infos]

    if not ips:
        return None

    if not all(_is_public_ip(ip) for ip in ips):
        return None

    return ips[0]


def _ip_netloc(ip: str, port: int | None) -> str:
    host = f'[{ip}]' if ipaddress.ip_address(ip).version == 6 else ip
    return host if port is None else f'{host}:{port}'


async def _pinned_request(
    endpoint: str,
    message: WebPushMessage,
) -> httpx.Request | None:
    parsed = urlparse(endpoint)

    if parsed.scheme != 'https' or not parsed.hostname:
        return None

    ip = await _resolve_pinned_ip(parsed.hostname, parsed.port or 443)

    if ip is None:
        return None

    host = parsed.hostname if parsed.port is None else f'{parsed.hostname}:{parsed.port}'

    return httpx.Request(
        'POST',
        parsed._replace(netloc=_ip_netloc(ip, parsed.port)).geturl(),
        content=message.encrypted,
        headers={**message.headers, 'host': host},
        extensions=dict(sni_hostname=parsed.hostname))


async def _send(
    endpoint: str,
    message: WebPushMessage,
    on_gone: Callable[[], Awaitable[None]],
) -> None:
    request = await _pinned_request(endpoint, message)

    if request is None:
        log('Web push blocked: endpoint is not a safe public HTTPS destination')
        return

    try:
        async with make_http_client(follow_redirects=False) as client:
            response = await client.send(request)
    except httpx.HTTPError as e:
        log(f'Web push request failed: {e}')
        return

    if response.status_code in (404, 410):
        await on_gone()
    elif response.status_code >= 400:
        log(f'Web push failed ({response.status_code})')


def enqueue_web_push(
    subscription: Json,
    title: str,
    body: str,
    on_gone: Callable[[], Awaitable[None]],
    data: Json = None,
) -> None:
    if _web_push is None:
        return

    endpoint = (
        subscription.get('endpoint')
        if isinstance(subscription, dict)
        else None)

    if not isinstance(endpoint, str):
        return

    try:
        message = _web_push.get(
            message=json.dumps(dict(title=title, body=body, data=data)),
            subscription=WebPushSubscription.model_validate(subscription))
    except (ValidationError, WebPushException, ValueError) as e:
        log(f'Web push encoding failed: {e}')
        return

    task = asyncio.create_task(_send(endpoint, message, on_gone))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
