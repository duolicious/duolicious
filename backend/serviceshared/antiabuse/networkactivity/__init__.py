from typing import Literal

DECAY_SECONDS = 30 * 24 * 60 * 60


def network_sql(ip_address: str) -> str:
    return f"""network(set_masklen(
            {ip_address},
            CASE family({ip_address}) WHEN 4 THEN 24 ELSE 64 END
        ))"""


def decay_sql(since: str, until: str) -> str:
    return (
        f'exp(extract(EPOCH FROM {since} - {until})::FLOAT8'
        f' / {DECAY_SECONDS})')


_DECAY_SINCE_UPDATE = decay_sql('network_activity.updated_at', 'now()')


def count_network_activity_sql(
    column: Literal['sign_ups', 'shadow_bans'],
    sessions: str,
) -> str:
    return f"""
    INSERT INTO network_activity_delta (
        network,
        {column}
    )
    SELECT DISTINCT
        {network_sql(f'{sessions}.ip_address')},
        1
    FROM
        {sessions}
    WHERE
        {sessions}.ip_address IS NOT NULL
    AND
        {sessions}.signed_in_at IS NOT NULL
"""


_DECAY_SINCE_DELTA = decay_sql('consumed.created_at', 'now()')

Q_FOLD_NETWORK_ACTIVITY = f"""
WITH consumed AS (
    DELETE FROM
        network_activity_delta
    RETURNING
        network,
        sign_ups,
        shadow_bans,
        created_at
), folded AS (
    SELECT
        consumed.network,
        sum(consumed.sign_ups * {_DECAY_SINCE_DELTA}) AS sign_ups,
        sum(consumed.shadow_bans * {_DECAY_SINCE_DELTA}) AS shadow_bans
    FROM
        consumed
    GROUP BY
        consumed.network
)
INSERT INTO network_activity (
    network,
    sign_ups,
    shadow_bans
)
SELECT
    network,
    sign_ups,
    shadow_bans
FROM
    folded
ON CONFLICT (network) DO UPDATE SET
    sign_ups =
        EXCLUDED.sign_ups
        + network_activity.sign_ups * {_DECAY_SINCE_UPDATE},
    shadow_bans =
        EXCLUDED.shadow_bans
        + network_activity.shadow_bans * {_DECAY_SINCE_UPDATE},
    updated_at = now()
"""


NETWORK_EVENT = f"""
network_event AS (
    SELECT DISTINCT
        {network_sql('duo_session.ip_address')} AS network,
        person.id AS person_id,
        event.kind,
        event.at
    FROM
        person
    JOIN
        duo_session
    ON
        duo_session.person_id = person.id
    CROSS JOIN LATERAL (
        VALUES
            ('sign up', person.sign_up_time),
            ('shadow ban', person.shadow_banned_at)
    ) AS event(kind, at)
    WHERE
        duo_session.ip_address IS NOT NULL
    AND
        duo_session.signed_in_at < event.at
)
"""


def replayed_sql(kind: Literal['sign up', 'shadow ban'], until: str) -> str:
    return f"""coalesce(sum({decay_sql('network_event.at', until)})
        FILTER (WHERE network_event.kind = '{kind}'), 0)"""


_IS_UNSEEDED = 'NOT EXISTS (SELECT 1 FROM network_activity)'

Q_SEED_NETWORK_ACTIVITY = f"""
WITH discarded AS (
    DELETE FROM
        network_activity_delta
    WHERE
        {_IS_UNSEEDED}
), {NETWORK_EVENT}
INSERT INTO network_activity (
    network,
    sign_ups,
    shadow_bans
)
SELECT
    network_event.network,
    {replayed_sql('sign up', 'now()')},
    {replayed_sql('shadow ban', 'now()')}
FROM
    network_event
WHERE
    {_IS_UNSEEDED}
GROUP BY
    network_event.network
ON CONFLICT (network) DO NOTHING
"""
