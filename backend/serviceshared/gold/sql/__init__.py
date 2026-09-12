from serviceshared.constants import CLUB_QUOTA_FREE, CLUB_QUOTA_GOLD


def has_gold_sql(person_id: str) -> str:
    return f"""EXISTS (
    SELECT 1 FROM gold_subscription
    WHERE person_id = {person_id} AND expires_at > NOW()
)"""


def club_quota_sql(has_gold: str) -> str:
    return f"""CASE
    WHEN {has_gold}
    THEN {CLUB_QUOTA_GOLD}
    ELSE {CLUB_QUOTA_FREE}
END"""

Q_HAS_GOLD = f"""
SELECT
    {has_gold_sql('%(person_id)s')} AS has_gold
"""

Q_SYNC_GOLD = f"""
WITH target AS (
    SELECT
        person.id,
        {has_gold_sql('person.id')} AS has_gold,
        {club_quota_sql(has_gold_sql('person.id'))} AS quota
    FROM
        person
    WHERE
        id = ANY(%(person_ids)s)
), reset_person AS (
    UPDATE
        person
    SET
        title_color = DEFAULT,
        body_color = DEFAULT,
        background_color = DEFAULT,

        show_my_location_id = DEFAULT,
        show_my_age = DEFAULT,
        show_my_looking_for = DEFAULT,
        hide_me_from_strangers = DEFAULT,
        browse_invisibly = DEFAULT
    FROM
        target
    WHERE
        person.id = target.id
    AND
        NOT target.has_gold
), over_quota AS (
    SELECT
        id,
        quota
    FROM
        target
    WHERE
        (SELECT COUNT(*) FROM person_club WHERE person_id = target.id) > quota
), ranked_person_club AS (
    SELECT
        person_club.person_id,
        person_club.club_name,
        ROW_NUMBER() OVER (
            PARTITION BY person_club.person_id
            ORDER BY club.count_members ASC, club.name ASC
        ) AS rn,
        over_quota.quota
    FROM
        person_club
    JOIN
        club
    ON
        club.name = person_club.club_name
    JOIN
        over_quota
    ON
        over_quota.id = person_club.person_id
), deleted_person_club AS (
    DELETE FROM
        person_club
    USING
        ranked_person_club
    WHERE
        person_club.person_id = ranked_person_club.person_id
    AND
        person_club.club_name = ranked_person_club.club_name
    AND
        ranked_person_club.rn > ranked_person_club.quota
    RETURNING
        person_club.person_id
)
SELECT
    (SELECT array_agg(DISTINCT person_id) FROM deleted_person_club) AS evicted_person_ids
"""

Q_GRANT_GOLD = """
INSERT INTO gold_subscription (
    provider,
    provider_subscription_id,
    person_id,
    expires_at
)
SELECT
    %(provider)s,
    %(provider_subscription_id)s,
    id,
    %(expires_at)s::TIMESTAMP
FROM
    person
WHERE
    uuid = uuid_or_null(%(person_uuid)s::TEXT)
ON CONFLICT (person_id) DO UPDATE SET
    provider = EXCLUDED.provider,
    provider_subscription_id = EXCLUDED.provider_subscription_id,
    expires_at = EXCLUDED.expires_at
WHERE
    (gold_subscription.provider, gold_subscription.provider_subscription_id)
        = (EXCLUDED.provider, EXCLUDED.provider_subscription_id)
OR
    gold_subscription.expires_at < EXCLUDED.expires_at
RETURNING
    person_id
"""

Q_REVOKE_GOLD = """
DELETE FROM
    gold_subscription
WHERE
    person_id = (SELECT id FROM person WHERE uuid = uuid_or_null(%(person_uuid)s::TEXT))
AND
    provider = %(provider)s
RETURNING
    person_id
"""
