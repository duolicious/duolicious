from async_lru_cache import AsyncLruCache
from database import api_tx
from enum import Enum
from dataclasses import dataclass
from chatprotocol.outbound import MessageBlocked, Outbound

class DefaultRateLimit(Enum):
    NONE = 0
    UNVERIFIED = 10
    BASICS = 20
    PHOTOS = 30


Q_RATE_LIMIT_REASON = f"""
WITH truncated_daily_message AS (
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
        {max(x.value for x in DefaultRateLimit)}
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
), truncated_daily_message_count AS (
    SELECT COUNT(*) AS x FROM truncated_daily_message
)
SELECT
    person.verification_level_id,
    truncated_daily_message_count.x AS daily_message_count,
    recent_manual_report_count.count AS recent_manual_report_count,
    recent_rude_message_count.count AS recent_rude_message_count
FROM
    person,
    truncated_daily_message_count,
    recent_manual_report_count,
    recent_rude_message_count
WHERE
    id = %(from_id)s
"""


@dataclass(frozen=True)
class Row:
    verification_level_id: int
    daily_message_count: int
    recent_manual_report_count: int
    recent_rude_message_count: int


def get_default_rate_limit(row: Row) -> DefaultRateLimit:
    if row.verification_level_id == 3:
        default_limit = DefaultRateLimit.PHOTOS
    elif row.verification_level_id == 2:
        default_limit = DefaultRateLimit.BASICS
    elif row.verification_level_id == 1:
        default_limit = DefaultRateLimit.UNVERIFIED
    else:
        raise Exception('Unhandled verification_level_id')

    penalty_exponent = 0
    penalty_exponent += row.recent_manual_report_count
    penalty_exponent += row.recent_rude_message_count // 2

    limit = default_limit.value // 2 ** penalty_exponent

    if limit == 0:
        # DefaultRateLimit.PHOTOS
        return max(DefaultRateLimit, key=lambda e: e.value)
    elif row.daily_message_count >= limit:
        return default_limit
    else:
        return DefaultRateLimit.NONE


def get_stanza(default_rate_limit: object, stanza_id: str) -> list[Outbound]:
    if default_rate_limit == DefaultRateLimit.NONE:
        return []
    elif default_rate_limit == DefaultRateLimit.UNVERIFIED:
        return [MessageBlocked(
                stanza_id=stanza_id,
                reason='rate-limited-1day',
                subreason='unverified-basics')]
    elif default_rate_limit == DefaultRateLimit.BASICS:
        return [MessageBlocked(
                stanza_id=stanza_id,
                reason='rate-limited-1day',
                subreason='unverified-photos')]
    elif default_rate_limit == DefaultRateLimit.PHOTOS:
        return [MessageBlocked(
                stanza_id=stanza_id,
                reason='rate-limited-1day')]
    else:
        raise Exception(f'Unhandled rate limit reason {default_rate_limit}')


def pure_maybe_fetch_rate_limit(row: Row, stanza_id: str) -> list[Outbound]:
    default_rate_limit = get_default_rate_limit(row)

    return get_stanza(default_rate_limit, stanza_id)


@AsyncLruCache(maxsize=1024, ttl=5)  # 5 seconds
async def fetch_rate_limit_reason(from_id: int) -> Row:
    async with api_tx('read committed') as tx:
        row = await tx.require_one(Q_RATE_LIMIT_REASON, dict(from_id=from_id))

    return Row(
        verification_level_id=row['verification_level_id'],
        daily_message_count=row['daily_message_count'],
        recent_manual_report_count=row['recent_manual_report_count'],
        recent_rude_message_count=row['recent_rude_message_count'],
    )


async def maybe_fetch_rate_limit(from_id: int, stanza_id: str) -> list[Outbound]:
    row = await fetch_rate_limit_reason(from_id=from_id)

    return pure_maybe_fetch_rate_limit(row, stanza_id)
