"""
Redis-backed cache for the per-request session lookup performed by
`require_auth` (see service/api/decorators.py).

Every authenticated request resolves its bearer token to a `SessionInfo` by
running `Q_GET_SESSION` against Postgres. That query is a primary-key point
read, but the Flask API funnels *all* of its database work through a single
shared connection guarded by a process-wide lock (`_api_conn_lock` in
database/__init__.py), so the lookup serializes every authenticated request
behind that lock. Caching the resolved session in Redis keeps the common case
(a valid, unchanged session) off both the lock and the database entirely.

Correctness model
-----------------
The cache is keyed by `session_token_hash` and stores only the fields
`require_auth` needs. The cached fields are nearly immutable per token; the
mutations that change them invalidate the entry explicitly via
`delete_session()`:

  * sign-out                  -> session deleted        (post_sign_out)
  * OTP sign-in               -> `signed_in` flips TRUE (post_check_otp)
  * finish onboarding         -> `person_id` is set     (post_finish_onboarding)
  * search-preference update  -> `pending_club_name`    (get_search)
                                 cleared
  * account deletion / ban    -> sessions cascade-deleted (delete_or_ban_account)
  * auto-deactivate cron      -> sessions deleted        (autodeactivate2)

Person-level deletions (account deletion, admin bans, the auto-deactivate
cron) remove sessions by `person_id`, which would otherwise leave the cache —
keyed by token hash — with no key to evict. They handle this by reading the
affected `session_token_hash`es before the delete and evicting every one, so a
person's *other* devices are covered too, not just the calling session.

`SESSION_CACHE_TTL_SECONDS` is then the backstop for the one case explicit
invalidation can't cover: the read-then-recache race. A request that misses
the cache reads the row from Postgres and then writes it back; if an
invalidating mutation lands in that (sub-millisecond, no-lock-held) window, the
re-write can resurrect the just-stale row, and it stays cached for at most one
TTL.

Redis is treated as a best-effort accelerator: any Redis error degrades to a
cache miss / no-op so authentication keeps working off Postgres alone.
"""

import time
from typing import cast

import duotypes
from redisclient import make_redis_client


# Upper bound on how long a resolved session may be served from cache without
# being re-read from Postgres. Mutations we can hook invalidate immediately;
# this only bounds staleness for the person-level deletes described above.
SESSION_CACHE_TTL_SECONDS: int = 60

_KEY_PREFIX = "cached_duo_session:"

# Dedicated async client (see `redisclient.make_redis_client` for the
# connection settings and the rationale behind the bounded timeouts -- they're
# what lets every function below degrade to a cache miss / no-op instead of
# blocking indefinitely on a slow Redis).
_redis = make_redis_client()


def _key(session_token_hash: str) -> str:
    return _KEY_PREFIX + session_token_hash


async def get_session(session_token_hash: str) -> duotypes.SessionInfo | None:
    """
    Return the cached `SessionInfo` for `session_token_hash`, or None on a miss
    (including any Redis error, which is treated as a miss so the caller falls
    back to the database).
    """
    try:
        cached = cast(dict, await _redis.hgetall(_key(session_token_hash)))
    except Exception:
        return None

    if not cached:
        return None

    # `person_id` is NULL for sessions that haven't finished onboarding yet;
    # we encode that as the absence of the field rather than a sentinel string.
    person_id = cached.get("person_id")
    person_uuid = cached.get("person_uuid")
    pending_club_name = cached.get("pending_club_name")

    return duotypes.SessionInfo(
        email=cached["email"],
        session_token_hash=session_token_hash,
        person_id=int(person_id) if person_id is not None else None,
        person_uuid=person_uuid,
        signed_in=cached["signed_in"] == "1",
        pending_club_name=pending_club_name,
    )


async def put_session(
    session_info: duotypes.SessionInfo,
    session_expiry_epoch: float | None,
) -> None:
    """
    Cache `session_info`. The entry's TTL is the smaller of
    `SESSION_CACHE_TTL_SECONDS` and the session's remaining lifetime, so a
    cached entry can never outlive the real `session_expiry` and resurrect an
    expired session.
    """
    ttl = SESSION_CACHE_TTL_SECONDS
    if session_expiry_epoch is not None:
        ttl = min(ttl, int(session_expiry_epoch - time.time()))
    if ttl <= 0:
        return

    # Omit NULL fields entirely; Redis hashes can't store None, and
    # `get_session` reconstructs the absent ones back to None.
    mapping = {
        "email": session_info.email,
        "signed_in": "1" if session_info.signed_in else "0",
    }
    if session_info.person_id is not None:
        mapping["person_id"] = str(session_info.person_id)
    if session_info.person_uuid is not None:
        mapping["person_uuid"] = session_info.person_uuid
    if session_info.pending_club_name is not None:
        mapping["pending_club_name"] = session_info.pending_club_name

    key = _key(session_info.session_token_hash)
    try:
        pipe = _redis.pipeline()
        pipe.delete(key)
        pipe.hset(key, mapping=cast(dict, mapping))
        pipe.expire(key, ttl)
        await pipe.execute()
    except Exception:
        pass


async def delete_session(session_token_hash: str) -> None:
    """
    Drop the cached entry for `session_token_hash`. Call this after any
    mutation that changes a cached field for this exact session.
    """
    try:
        await _redis.delete(_key(session_token_hash))
    except Exception:
        pass
