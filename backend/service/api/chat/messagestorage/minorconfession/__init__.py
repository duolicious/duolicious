from service.api.chat.messagestorage.mam import (
    StoreMamMessageJob,
    microseconds_to_mam_message_id,
)
from serviceshared.antiabuse.lodgereport import skip_by_uuid
from serviceshared.antiabuse.minorconfession.stage1 import (
    may_confess_minor,
)
from serviceshared.antiabuse.minorconfession.stage2 import (
    is_minor_confession,
)
from serviceshared.antiabuse.sql import BOT_ACCOUNT_SQL
from serviceshared.batcher import Batcher
from serviceshared.database import api_tx
import asyncio
import logging

logger = logging.getLogger(__name__)

Q_SELECT_CONVERSATIONS = f"""
WITH bot_account AS ({BOT_ACCOUNT_SQL})
SELECT
    bot_account.uuid::TEXT AS subject_uuid,
    person.uuid::TEXT AS object_uuid,
    person.about,
    EXTRACT(YEAR FROM age(person.date_of_birth))::INT AS claimed_age,
    job.body,
    (
        SELECT
            COALESCE(
                json_agg(
                    json_build_object(
                        'is_me', recent.direction = 'O',
                        'body', recent.body
                    )
                    ORDER BY recent.id
                ),
                '[]'
            )
        FROM (
            SELECT
                id,
                direction,
                body
            FROM
                mam_message
            WHERE
                person_id = person.id
            AND
                remote_bare_jid = job.to_username
            AND
                id < job.mam_message_id
            ORDER BY
                id DESC
            LIMIT
                4
        ) AS recent
    ) AS before
FROM
    unnest(
        %(from_usernames)s::TEXT[],
        %(to_usernames)s::TEXT[],
        %(mam_message_ids)s::BIGINT[],
        %(bodies)s::TEXT[]
    ) AS job(from_username, to_username, mam_message_id, body)
JOIN
    person
ON
    person.uuid = uuid_or_null(job.from_username)
CROSS JOIN
    bot_account
"""


async def _process_batch(batch: list[StoreMamMessageJob]) -> None:
    passed = [
        job for job in batch
        if await asyncio.to_thread(may_confess_minor, job.message_body)]

    if not passed:
        return

    async with api_tx('read committed') as tx:
        await tx.execute(Q_SELECT_CONVERSATIONS, dict(
            from_usernames=[job.from_username for job in passed],
            to_usernames=[job.to_username for job in passed],
            mam_message_ids=[
                microseconds_to_mam_message_id(job.timestamp_microseconds)
                for job in passed],
            bodies=[job.message_body for job in passed],
        ))
        rows = await tx.fetchall()

    reported: set[str] = set()

    for row in rows:
        before = [(message['is_me'], message['body']) for message in row['before']]

        if \
                row['object_uuid'] in reported or \
                not await asyncio.to_thread(
                    is_minor_confession,
                    claimed_age=row['claimed_age'],
                    about=row['about'],
                    before=before,
                    target=row['body'],
                ):
            continue

        logger.info(f"{row['object_uuid']} reported")
        reported.add(row['object_uuid'])
        await skip_by_uuid(
            subject_uuid=row['subject_uuid'],
            object_uuid=row['object_uuid'],
            reason='Automatically lodged report: Child safety (chat)',
            source='chat model',
            messages=[
                *[
                    dict(sent_by='accused' if is_me else 'other person', body=body)
                    for is_me, body in before],
                dict(sent_by='accused (flagged message)', body=row['body']),
            ],
        )


minor_confession_batcher = Batcher[StoreMamMessageJob](
    process_fn=_process_batch,
    flush_interval=1,
    max_batch_size=1000,
)
