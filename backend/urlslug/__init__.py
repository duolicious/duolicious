from typing import Iterator
from database import Tx, row_bool
import psycopg
import random
import re

# Profiles live at the top level of the web app (/<url_slug>), so a slug must
# never equal one of the app's own routes or it would shadow it. This set must
# mirror the frontend's top-level paths (see App.tsx's linking config) plus the
# legacy URLs the web client normalizes away.
RESERVED_SLUGS = {
    # Top-level static routes.
    'email', 'sign-in', 'qa', 'search', 'feed', 'inbox', 'visitors', 'profile',
    # Prefixes of multi-segment routes.
    'chat', 'gallery', 'in-depth', 'invite',
    # Nested routes under /profile and /search.
    'settings', 'clubs', 'invites', 'filters', 'edit',
    # Legacy URLs the web client rewrites to the root.
    'me', 'welcome',
    # Not a route: the Google OAuth redirect (`app.duolicious:/oauthredirect`)
    # is delivered to the Android app as a deep link, where it would otherwise
    # match the top-level profile slug. The web client collapses it to the root
    # (see linking.tsx); reserving it here stops anyone from minting a profile
    # that the deep link would shadow.
    'oauthredirect',
}

# Number of randomly-suffixed candidates to try before giving up. Each attempt
# draws from one more digit than the last (single digit, then two, ...), so the
# suffix stays short when there's little contention but the space grows fast
# enough that a collision on every attempt is astronomically unlikely. The last
# attempt draws a 10-digit number, which is where the spec says to give up.
_MAX_RANDOM_ATTEMPTS = 10

# A slug must never be UUID-shaped: profiles are also served by uuid, so a
# UUID-shaped slug would collide with a real person's uuid in the profile
# resolver. Such a base is treated as unusable (it gets a numeric suffix, which
# breaks the shape).
_UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

Q_SELECT_PERSON = 'SELECT name, email FROM person WHERE id = %(person_id)s'
Q_UPDATE_PERSON_SLUG = (
    'UPDATE person SET url_slug = %(slug)s WHERE id = %(person_id)s')
Q_UPDATE_ONBOARDEE_SLUG = (
    'UPDATE onboardee SET url_slug = %(slug)s WHERE email = %(email)s')

# A candidate is taken if any person already holds it, or any *other* onboardee
# has reserved it. Counting onboardee reservations is what stops an in-flight
# onboardee's previewed slug from being minted out from under them before they
# finish. The caller's own rows are excluded so re-deriving a slug for the same
# identity is idempotent rather than bumping the suffix: by person_id (a person
# re-saving the same display name must keep their slug, not collide with self)
# and by email (an onboardee re-previewing the same name). A NULL exclusion key
# matches nothing, so the whole table counts.
Q_SLUG_TAKEN = """
SELECT EXISTS (
    SELECT 1 FROM person
        WHERE url_slug = %(slug)s
        AND id IS DISTINCT FROM %(person_id)s
    UNION ALL
    SELECT 1 FROM onboardee
        WHERE url_slug = %(slug)s
        AND email IS DISTINCT FROM %(email)s
)
"""

def slug_base(name: str) -> str:
    """Lowercase the name, turn spaces into underscores, and keep only
    [a-z0-9_-]. May return ''."""
    return re.sub(r'[^a-z0-9_-]', '', name.lower().replace(' ', '_'))

def is_base_usable(base: str) -> bool:
    """Whether `base` can be minted as the bare slug, rather than needing a
    numeric suffix. Empty, reserved and UUID-shaped bases are unusable."""
    return (
        bool(base)
        and base not in RESERVED_SLUGS
        and not _UUID_RE.match(base))

def _candidates(base: str) -> Iterator[tuple[str, bool]]:
    """Yields (slug, is_random) to try, in order: the bare base first (when
    usable), then random numeric suffixes that grow by a digit each attempt."""
    if is_base_usable(base):
        yield base, False

    for digits in range(_MAX_RANDOM_ATTEMPTS):
        lo = 10 ** digits
        hi = 10 ** (digits + 1) - 1
        n = random.randint(lo, hi)
        yield (f'{base}{n}' if base else str(n)), True

async def _mint(
    tx: Tx,
    base: str,
    write_q: str,
    write_params: dict[str, object],
    *,
    email: str,
    person_id: int | None = None,
) -> dict[str, object]:
    """Async counterpart to `_mint` for native FastAPI routes."""
    for slug, is_random in _candidates(base):
        row = await tx.require_one(
            Q_SLUG_TAKEN,
            dict(slug=slug, email=email, person_id=person_id),
        )
        taken = row_bool(row, 'exists')
        if taken:
            continue
        try:
            async with tx.connection.transaction():
                await tx.execute(write_q, dict(write_params, slug=slug))
        except psycopg.errors.UniqueViolation:
            continue
        return dict(url_slug=slug, is_random=is_random)

    raise RuntimeError(f'could not mint url_slug for base {base!r}')

async def reserve_onboardee_url_slug(
    tx: Tx,
    email: str,
    name: str,
) -> dict[str, object]:
    """Async counterpart to `reserve_onboardee_url_slug`."""
    return await _mint(
        tx,
        slug_base(name),
        Q_UPDATE_ONBOARDEE_SLUG,
        dict(email=email),
        email=email)

async def assign_url_slug(
    tx: Tx,
    person_id: int,
) -> dict[str, object]:
    """Async counterpart to `assign_url_slug`."""
    person = await (await tx.execute(
        Q_SELECT_PERSON,
        dict(person_id=person_id),
    )).fetchone()
    if person is None:
        raise RuntimeError(f'person {person_id} not found')

    return await _mint(
        tx,
        slug_base(person['name']),
        Q_UPDATE_PERSON_SLUG,
        dict(person_id=person_id),
        email=person['email'],
        person_id=person_id)
