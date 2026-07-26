from async_lru_cache import AsyncLruCache
from database import api_tx, row_str

Q_SELECT_PUSH_TOKENS = """
WITH session_summary AS (
    SELECT
        ARRAY_AGG(DISTINCT duo_session.push_token)
            FILTER (WHERE duo_session.push_token IS NOT NULL) AS push_tokens,
        MAX(duo_session.last_online_time)
            FILTER (WHERE duo_session.push_token IS NULL) AS web_last_online,
        MAX(duo_session.last_online_time)
            FILTER (WHERE duo_session.push_token IS NOT NULL) AS mobile_last_online
    FROM
        duo_session
    JOIN
        person
    ON
        person.id = duo_session.person_id
    WHERE
        person.uuid = uuid_or_null(%(username)s)
    AND
        duo_session.signed_in
)
SELECT
    unnest(push_tokens) AS token
FROM
    session_summary
WHERE
    -- A web session being strictly more recent means we defer the whole
    -- notification to the cron, which pushes *and* emails. Pushing here would
    -- upsert the last-notification time and suppress that email. Ties favour
    -- mobile, matching the cron's web-vs-mobile comparison.
    NOT COALESCE(web_last_online > mobile_last_online, FALSE)
"""


@AsyncLruCache(ttl=2 * 60)  # 2 minutes
async def fetch_push_tokens(username: str) -> list[str]:
    async with api_tx('read committed') as tx:
        await tx.execute(Q_SELECT_PUSH_TOKENS, dict(username=username))
        rows = await tx.fetchall()

    return list({row_str(row, 'token') for row in rows})
