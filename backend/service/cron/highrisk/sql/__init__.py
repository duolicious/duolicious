from serviceshared.antiabuse.sql import BOT_ACCOUNT_SQL
from serviceshared.gold.sql import has_gold_sql

Q_SELECT_NEW_PEOPLE = f"""
WITH bot_account AS ({BOT_ACCOUNT_SQL})
SELECT
    bot_account.uuid AS bot_uuid,
    person.id AS person_id,
    person.uuid AS person_uuid,
    {has_gold_sql('person.id')} AS has_gold,
    extract(EPOCH FROM now() - person.sign_up_time)::FLOAT8 / 3600
        AS hours_since_sign_up,
    (
        SELECT
            max(score)
        FROM
            high_risk_score
        WHERE
            high_risk_score.person_id = person.id
    ) AS previous_score,
    ARRAY(
        SELECT
            hours
        FROM
            high_risk_score
        WHERE
            high_risk_score.person_id = person.id
    ) AS previous_hours
FROM
    person
CROSS JOIN
    bot_account
WHERE
    person.sign_up_time > now() - %(max_hours)s * INTERVAL '1 hour'
AND
    person.gender_id IN (1, 2)
AND
    person.verification_level_id < 3
AND
    person.shadow_banned_at IS NULL
AND NOT EXISTS (
    SELECT
        1
    FROM
        photo
    WHERE
        photo.person_id = person.id
    AND
        photo.nsfw_score_v2 IS NULL
)
"""

Q_INSERT_SCORE = """
INSERT INTO high_risk_score (
    person_id,
    hours,
    score
) VALUES (
    %(person_id)s,
    %(hours)s,
    %(score)s
) ON CONFLICT DO NOTHING
"""

Q_REQUIRE_PHOTO_VERIFICATION = """
UPDATE
    person
SET
    required_verification_level_id = 3
WHERE
    id = %(person_id)s
"""
