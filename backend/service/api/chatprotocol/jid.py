"""
Dependency-light JID helpers.

Kept free of database/redis imports so the protocol layer (and unit tests) can
use them without pulling in the rest of the service.
"""
import uuid


LSERVER = 'duolicious.app'


def to_bare_jid(jid: str | None) -> str | None:
    if jid is None:
        return None

    try:
        return jid.split('@')[0]
    except Exception:
        return None


def jid_to_username(jid: str | None) -> str | None:
    """
    Extracts the bare JID's local part and returns it iff it's a valid UUID
    (our usernames are UUIDs), else None.
    """
    bare = to_bare_jid(jid)
    if bare is None:
        return None

    try:
        return str(uuid.UUID(bare))
    except Exception:
        return None
