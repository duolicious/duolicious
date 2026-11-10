from service.api.async_lru_cache import AsyncLruCache
from serviceshared.database import api_tx
from dataclasses import dataclass
from service.api.chatprotocol.outbound import MessageBlocked


@dataclass(frozen=True)
class Tier:
    daily_intros: int
    subreason: str | None


TIER_BY_VERIFICATION_LEVEL_ID = {
    1: Tier(daily_intros=32, subreason='unverified-basics'),
    2: Tier(daily_intros=64, subreason='unverified-photos'),
    3: Tier(daily_intros=128, subreason=None),
}


Q_SENDER = f"""
WITH daily_intro AS (
    SELECT
        1
    FROM
        messaged AS m1
    WHERE
        m1.subject_person_id = %(from_id)s
    AND
        m1.created_at >= NOW() - INTERVAL '24 HOURS'
    AND
        NOT EXISTS (
            SELECT
                1
            FROM
                messaged AS m2
            WHERE
                m2.subject_person_id = m1.object_person_id
            AND
                m2.object_person_id = m1.subject_person_id
            AND
                m2.created_at < m1.created_at
        )
    LIMIT
        {max(t.daily_intros for t in TIER_BY_VERIFICATION_LEVEL_ID.values())}
), recent_manual_report_count AS (
    SELECT
        count(*)
    FROM
        skipped
    WHERE
        object_person_id = %(from_id)s
    AND
        created_at > now() - interval '7 days'
    AND
        reported
    AND NOT EXISTS (
        SELECT
            1
        FROM
            person
        WHERE
            person.id = subject_person_id
        AND
            person.roles @> ARRAY['bot']
    )
), recent_rude_message_count AS (
    SELECT
        count(*)
    FROM
        rude_message
    WHERE
        person_id = %(from_id)s
    AND
        created_at > now() - interval '1 day'
), daily_intro_count AS (
    SELECT COUNT(*) AS x FROM daily_intro
)
SELECT
    person.verification_level_id,
    daily_intro_count.x AS daily_intro_count,
    recent_manual_report_count.count AS recent_manual_report_count,
    recent_rude_message_count.count AS recent_rude_message_count
FROM
    person,
    daily_intro_count,
    recent_manual_report_count,
    recent_rude_message_count
WHERE
    id = %(from_id)s
"""


@dataclass(frozen=True)
class Sender:
    verification_level_id: int
    daily_intro_count: int
    recent_manual_report_count: int
    recent_rude_message_count: int


def intro_limit_block(sender: Sender, stanza_id: str) -> MessageBlocked | None:
    tier = TIER_BY_VERIFICATION_LEVEL_ID[sender.verification_level_id]

    halvings = (
        sender.recent_manual_report_count +
        sender.recent_rude_message_count // 2
    )

    daily_intros = tier.daily_intros // 2 ** halvings

    if sender.daily_intro_count < daily_intros:
        return None

    return MessageBlocked(
        stanza_id=stanza_id,
        reason='rate-limited-1day',
        subreason=tier.subreason if daily_intros else None,
    )


@AsyncLruCache(maxsize=1024, ttl=5)  # 5 seconds
async def fetch_sender(from_id: int) -> Sender:
    async with api_tx('read committed') as tx:
        row = await tx.require_one(Q_SENDER, dict(from_id=from_id))

    return Sender(**row)


async def fetch_intro_limit_block(
    from_id: int,
    stanza_id: str,
) -> MessageBlocked | None:
    return intro_limit_block(await fetch_sender(from_id), stanza_id)
