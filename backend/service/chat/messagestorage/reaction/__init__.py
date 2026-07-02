"""
Persistence for emoji message reactions.

A reaction is stored directly on the target message's `mam_message` rows (the
`reaction` column) rather than as separate rows, so old clients never replay it
as a text bubble. Reactions are keyed on the server-assigned `mam_message.id`
(never the client-supplied `stanza_id`).

A message is archived as two rows whose ids differ only in the low bit -- the
sender copy is `microseconds << 8` and the recipient copy is that value `+ 1`
(see `Q_INSERT_MESSAGE` in `service/chat/messagestorage/mam`). So the partner's
copy of any message is `id ^ 1`. A reaction updates both copies by their
`(person_id, id)` primary key.

A user may only react to the *other* person's messages, so the reactor's update
is guarded by `direction = 'I'`. Each message therefore has at most one
reaction, and who reacted is implied by the row's `direction`.

The partner (whose message is being reacted to) is always *derived* from the
reactor's own incoming copy via `fetch_reaction_partner`, never trusted from the
client, so a reaction can't be aimed at an arbitrary third party.

The target row is guaranteed to already exist: a message is delivered to the
recipient only by the batcher's post-flush callback (see `Batcher._process_batch`),
so no client can learn a message's `mam_id` until after its rows are committed.
A missing target therefore means a genuinely absent or own-message reaction, not
a not-yet-flushed one.
"""
from database import api_tx
from service.chat.messagestorage.mam import sibling_mam_id


Q_FETCH_REACTION_PARTNER = """
SELECT
    remote_bare_jid AS partner_username
FROM
    mam_message
WHERE
    person_id = (SELECT id FROM person WHERE uuid = uuid_or_null(%(reactor_username)s))
AND
    id = %(reactor_copy_id)s
AND
    direction = 'I'
"""


Q_SET_REACTION_REACTOR = """
UPDATE
    mam_message
SET
    reaction = %(reaction)s
WHERE
    person_id = (SELECT id FROM person WHERE uuid = uuid_or_null(%(reactor_username)s))
AND
    id = %(reactor_copy_id)s
AND
    direction = 'I'
RETURNING
    1
"""


Q_SET_REACTION_BOTH = """
WITH target AS (
    SELECT
        reactor_person.id AS reactor_person_id,
        partner_person.id AS partner_person_id,
        %(reactor_copy_id)s::BIGINT AS reactor_copy_id,
        %(partner_copy_id)s::BIGINT AS partner_copy_id
    FROM
        person AS reactor_person
    CROSS JOIN
        person AS partner_person
    WHERE
        reactor_person.uuid = uuid_or_null(%(reactor_username)s)
    AND
        partner_person.uuid = uuid_or_null(%(partner_username)s)
    AND
        EXISTS (
            SELECT
                1
            FROM
                mam_message
            WHERE
                person_id = reactor_person.id
            AND
                id = %(reactor_copy_id)s
            AND
                direction = 'I'
        )
    AND
        EXISTS (
            SELECT
                1
            FROM
                mam_message
            WHERE
                person_id = partner_person.id
            AND
                id = %(partner_copy_id)s
        )
),
updated AS (
UPDATE
    mam_message
SET
    reaction = %(reaction)s
FROM
    target
WHERE
    (
        person_id = target.reactor_person_id
    AND
        id = target.reactor_copy_id
    AND
        direction = 'I'
    )
OR
    (
        person_id = target.partner_person_id
    AND
        id = target.partner_copy_id
    )
RETURNING
    1
)
SELECT
    COUNT(*) AS updated_count
FROM
    updated
"""


async def fetch_reaction_partner(
    reactor_username: str,
    reactor_copy_id: int,
) -> str | None:
    """
    The username of the person whose message the reactor is reacting to, taken
    from the `remote_bare_jid` of the reactor's own incoming archive copy.
    Returns None when the target isn't a message the reactor received (their own
    message, or a non-existent id), which the caller should reject.
    """
    async with api_tx('read committed') as tx:
        await tx.execute(
            Q_FETCH_REACTION_PARTNER,
            dict(
                reactor_username=reactor_username,
                reactor_copy_id=reactor_copy_id,
            ),
        )
        row = await tx.fetchone()

    return row['partner_username'] if row else None


async def store_reaction(
    reactor_username: str,
    partner_username: str,
    reactor_copy_id: int,
    emoji: str,
    deliver_to_recipient: bool = True,
) -> bool:
    """
    Set (or clear, when `emoji` is empty) the reactor's reaction on the target
    message. `partner_username` must be the server-derived partner (see
    `fetch_reaction_partner`), never the client-supplied value.

    Returns True if the reactor's own copy was updated -- i.e. the target exists
    and belongs to the other person. A False result means an own or deleted
    target and should be surfaced as a rejection.

    `deliver_to_recipient` is False for shadow-banned reactors: their own copy
    is still updated so their app behaves normally, but the partner's copy is
    left untouched.
    """
    partner_copy_id = sibling_mam_id(reactor_copy_id)
    reaction = emoji if emoji else None

    async with api_tx('read committed') as tx:
        if deliver_to_recipient:
            await tx.execute(
                Q_SET_REACTION_BOTH,
                dict(
                    reactor_username=reactor_username,
                    partner_username=partner_username,
                    reactor_copy_id=reactor_copy_id,
                    partner_copy_id=partner_copy_id,
                    reaction=reaction,
                ),
            )
            row = await tx.fetchone()
            return bool(row and row['updated_count'] == 2)

        await tx.execute(
            Q_SET_REACTION_REACTOR,
            dict(
                reactor_username=reactor_username,
                reactor_copy_id=reactor_copy_id,
                reaction=reaction,
            ),
        )
        row = await tx.fetchone()

    return row is not None
