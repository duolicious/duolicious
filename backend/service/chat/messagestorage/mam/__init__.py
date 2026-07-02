from dataclasses import dataclass
from database import Tx, api_tx
from service.chat.chatutil import (
    LSERVER,
    fetch_has_gold,
    format_datetime,
    format_timestamp,
)
from chatprotocol.inbound import MamQuery
from chatprotocol.mam_id import (
    decode_mam_id,
    encode_mam_id,
)
from chatprotocol.outbound import (
    MamFin,
    MamResult,
    Outbound,
    ReadReceipt,
)
import uuid


Q_INSERT_MESSAGE = """
INSERT INTO
    mam_message (
        id,
        from_jid,
        remote_bare_jid,
        direction,
        audio_uuid,
        body,
        stanza_id,
        person_id
    )
-- The sender's archive copy (direction 'O') is always stored. The recipient's
-- copy (direction 'I') is skipped when %(deliver_to_recipient)s is false (the
-- sender is shadow-banned), so the message never lands in the recipient's
-- archive.
SELECT
    %(id)s::BIGINT,
    '', -- from_jid is ignored
    %(to_username)s,
    'O'::mam_direction,
    %(audio_uuid)s,
    %(body)s,
    %(stanza_id)s,
    (SELECT id FROM person WHERE uuid = uuid_or_null(%(from_username)s))
UNION ALL
SELECT
    %(id)s::BIGINT + 1,
    '', -- from_jid is ignored
    %(from_username)s,
    'I'::mam_direction,
    %(audio_uuid)s,
    %(body)s,
    %(stanza_id)s,
    (SELECT id FROM person WHERE uuid = uuid_or_null(%(to_username)s))
WHERE
    %(deliver_to_recipient)s::BOOLEAN
"""


Q_SELECT_MESSAGE = f"""
WITH page AS (
    SELECT
        mam_message.id,
        mam_message.direction,
        mam_message.stanza_id,
        mam_message.body,
        mam_message.audio_uuid,
        mam_message.reaction
    FROM
        mam_message
    JOIN
        person
    ON
        person.id = mam_message.person_id
    WHERE
        person.uuid = %(from_username)s
    AND
        mam_message.remote_bare_jid = %(to_username)s
    AND (
        mam_message.id < %(before_id)s OR %(before_id)s IS NULL
    )
    ORDER BY
        mam_message.id DESC
    LIMIT
        LEAST(50, COALESCE(%(max)s, 50))
)
SELECT
    *
FROM
    page
ORDER BY
    id
"""


Q_SELECT_DISPLAYED_AT = f"""
SELECT
    displayed_at
FROM
    inbox
WHERE
    luser = %(partner)s
AND
    remote_bare_jid = %(viewer_jid)s
"""


@dataclass(frozen=True)
class StoreMamMessageJob:
    timestamp_microseconds: int
    from_username: str
    to_username: str
    id: str
    message_body: str
    audio_uuid: str | None
    deliver_to_recipient: bool = True


async def get_conversation(
    query: MamQuery,
    from_username: str,
) -> list[Outbound]:
    return await _get_conversation(
        query=query,
        from_username=from_username,
        to_username=query.with_username,
    )


async def process_store_mam_message_batch(tx: Tx, batch: list[StoreMamMessageJob]) -> None:
    params_seq = [
        dict(
            id=microseconds_to_mam_message_id(message.timestamp_microseconds),
            to_username=message.to_username,
            from_username=message.from_username,
            audio_uuid=message.audio_uuid,
            body=message.message_body,
            stanza_id=message.id,
            deliver_to_recipient=message.deliver_to_recipient,
        )
        for message in batch
    ]

    await tx.executemany(Q_INSERT_MESSAGE, params_seq)


async def _get_conversation(
    query: MamQuery,
    from_username: str,
    to_username: str
) -> list[Outbound]:
    before_id = decode_mam_id(query.before) if query.before else None

    params = dict(
        from_username=from_username,
        to_username=to_username,
        before_id=before_id,
        max=query.max,
    )

    async with api_tx('read committed') as tx:
        await tx.execute(Q_SELECT_MESSAGE, params)
        rows = await tx.fetchall()

    messages: list[Outbound] = []
    for row in rows:
        row_id = row['id']

        # From and to are the same on the envelope because the iq query was
        # made by `from_username` and the result is sent back to them.
        if row['direction'] == 'O':
            msg_from, msg_to = from_username, to_username
        else:
            msg_from, msg_to = to_username, from_username

        reaction = row['reaction']
        reaction_from = None
        if reaction is not None:
            reaction_from = 'self' if row['direction'] == 'I' else 'other'

        messages.append(MamResult(
            viewer_username=from_username,
            query_id=query.query_id,
            result_id=encode_mam_id(row_id),
            forwarded_id=str(uuid.uuid4()),
            stamp=mam_message_id_to_timestamp(row_id),
            msg_from_username=msg_from,
            msg_to_username=msg_to,
            stanza_id=row['stanza_id'],
            body=row['body'],
            audio_uuid=row['audio_uuid'],
            reaction=reaction,
            reaction_from=reaction_from,
        ))

    # The receipt belongs under the most recent outgoing message, so it's only
    # needed on the first (most recent) page, not on older pages fetched while
    # scrolling up.
    receipt = None if query.before else await _maybe_read_receipt(
        viewer=from_username,
        partner=to_username,
    )
    if receipt:
        messages.append(receipt)

    messages.append(MamFin(
        viewer_username=from_username,
        query_id=query.query_id,
    ))

    return messages


async def _maybe_read_receipt(viewer: str, partner: str) -> Outbound | None:
    if not await fetch_has_gold(viewer):
        return None

    async with api_tx('read committed') as tx:
        await tx.execute(
            Q_SELECT_DISPLAYED_AT,
            dict(partner=partner, viewer_jid=f'{viewer}@{LSERVER}'),
        )
        row = await tx.fetchone()

    if not row or not row['displayed_at']:
        return None

    return ReadReceipt(
        from_username=partner,
        to_username=viewer,
        stamp=format_datetime(row['displayed_at']),
    )


def microseconds_to_mam_message_id(microseconds: int) -> int:
    return microseconds << 8


def mam_message_id_to_microseconds(mam_message_id: int) -> int:
    return mam_message_id >> 8


def sibling_mam_id(mam_message_id: int) -> int:
    """
    The id of the *other* archive copy of the same message. A message is stored
    as two rows whose ids differ only in the low bit: the sender copy is
    `microseconds_to_mam_message_id(...)` and the recipient copy is that `+ 1`
    (see `Q_INSERT_MESSAGE`). Toggling the low bit therefore maps either copy to
    its sibling.
    """
    return mam_message_id ^ 1


def mam_message_id_to_timestamp(id: int) -> str:
    return format_timestamp(mam_message_id_to_microseconds(id))
