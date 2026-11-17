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


def count_sql(column: Literal['sign_ups', 'shadow_bans']) -> str:
    return f"""
INSERT INTO network_activity (
    network,
    {column}
)
SELECT DISTINCT
    {network_sql('ip_address')},
    1
FROM
    duo_session
WHERE
    person_id = ANY(%(person_ids)s::INT[])
AND
    ip_address IS NOT NULL
AND
    signed_in_at IS NOT NULL
ORDER BY
    1
ON CONFLICT (network) DO UPDATE SET
    sign_ups =
        EXCLUDED.sign_ups
        + network_activity.sign_ups * {_DECAY_SINCE_UPDATE},
    shadow_bans =
        EXCLUDED.shadow_bans
        + network_activity.shadow_bans * {_DECAY_SINCE_UPDATE},
    updated_at = now()
"""
