# Whether a person already exists with this normalized email. Shared so the
# sign-up OTP flow (`_OTP_CTE`) and the email-info lookup (`Q_EMAIL_INFO`) can
# never disagree on what "registered" means.
Q_IS_REGISTERED_BY_NORMALIZED_EMAIL = """
EXISTS (SELECT 1 FROM person WHERE normalized_email = %(normalized_email)s)
"""


# How a photo's square renditions were cropped from the original, or NULL when
# unrecorded (clients read NULL as "don't animate the crop"). The row must be
# aliased `photo`.
PHOTO_GEOMETRY = """
    CASE WHEN photo.width IS NOT NULL THEN json_build_object(
        'width',     photo.width,
        'height',    photo.height,
        'crop_top',  photo.crop_top,
        'crop_left', photo.crop_left
    ) END
"""


Q_UPDATE_VERIFICATION_LEVEL_ASSIGN = """
    verification_level_id = CASE
        WHEN EXISTS (
            SELECT
                1
            FROM
                photo
            WHERE
                person_id = person.id
            AND
                verified
        )
        THEN 3

        WHEN EXISTS (
            SELECT
                1
            FROM
                person p
            WHERE
                p.id = person.id
            AND
                p.verified_age
            AND
                p.verified_gender
        )
        THEN 2

        ELSE 1
    END
"""

Q_UPDATE_VERIFICATION_LEVEL = f"""
UPDATE
    person
SET
    {Q_UPDATE_VERIFICATION_LEVEL_ASSIGN}
WHERE
    id = %(person_id)s
"""

Q_UPDATE_LAST = """
WITH updated_person AS (
    UPDATE
        person
    SET
        last_online_time = NOW()
    WHERE
        uuid = %(person_uuid)s
    RETURNING
        id
)
INSERT INTO presence_histogram (
    person_id,
    dow,
    hour,
    score,
    updated_at
)
SELECT
    id,
    EXTRACT(DOW  FROM (now() AT TIME ZONE 'UTC'))::smallint AS dow,
    EXTRACT(HOUR FROM (now() AT TIME ZONE 'UTC'))::smallint AS hour,
    1::FLOAT4 AS score,
    now() AS updated_at
FROM
    updated_person
ON CONFLICT (person_id, dow, hour) DO UPDATE SET
    score = presence_histogram.score + EXCLUDED.score,
    updated_at = EXCLUDED.updated_at
WHERE
    presence_histogram.updated_at < EXCLUDED.updated_at - INTERVAL '1 hour'
"""

Q_UPSERT_LAST_INTRO_NOTIFICATION_TIME = """
UPDATE
    person
SET
    intro_seconds = extract(epoch from now() + INTERVAL '5 seconds')::int
WHERE
    uuid = uuid_or_null(%(username)s)
"""

Q_UPSERT_LAST_CHAT_NOTIFICATION_TIME = """
UPDATE
    person
SET
    chat_seconds = extract(epoch from now() + INTERVAL '5 seconds')::int
WHERE
    uuid = uuid_or_null(%(username)s)
"""

Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME = """
UPDATE
    person
SET
    visitor_seconds = extract(epoch from now() + INTERVAL '5 seconds')::int
WHERE
    uuid = uuid_or_null(%(username)s)
"""

Q_IS_ALLOWED_CLUB_NAME = """
WITH similar_banned_club AS (
    SELECT
        name
    FROM
        banned_club
    ORDER BY
        name <-> %()s
    LIMIT
        10
)
SELECT
    NOT EXISTS (
        SELECT
            1
        FROM
            similar_banned_club
        WHERE
            -- The exact club name is banned
            name = LOWER(%()s)
        OR
            -- The club name contains a banned word/phrase
            word_similarity(name, %()s) > 0.999
        AND
            -- The banned club name is distinctive enough not to trigger too
            -- many false positives when used as a word match
            (name ~ '[A-Za-z]{3}' OR name ~ '[^ ] [^ ]')
    ) AS is_allowed_club_name
"""

Q_COMPUTED_FLAIR = """
    SELECT
        COALESCE(
            array_agg(DISTINCT e ORDER BY e),
            ARRAY[]::TEXT[]
        ) AS computed_flair
    FROM (
        SELECT
            unnest(flair) AS e
        UNION
            SELECT 'gold' WHERE has_gold
        UNION
            SELECT CASE
                WHEN count_answers >= 1000 THEN 'q-and-a-1000'
                WHEN count_answers >=  500 THEN 'q-and-a-500'
                WHEN count_answers >=  200 THEN 'q-and-a-200'
            END
        UNION
            SELECT CASE
                WHEN sign_up_time <= now() - interval '1 year'  THEN 'one-year'
                WHEN sign_up_time <= now() - interval '1 month' THEN 'one-month'
                WHEN sign_up_time <= now() - interval '1 week'  THEN 'one-week'
            END
        UNION
            SELECT 'long-bio' WHERE length(about) >= 500
        UNION
            SELECT 'early-adopter' WHERE sign_up_time <= '2024-08-26 01:05:49'
        UNION
            SELECT 'gif' WHERE EXISTS (
                SELECT
                    1
                FROM
                    photo
                WHERE
                    photo.person_id = id
                AND
                    'gif' = ANY(photo.extra_exts)
            )
        UNION
            SELECT 'voice-bio' WHERE EXISTS (
                SELECT
                    1
                FROM
                    audio
                WHERE
                    audio.person_id = id
            )
    ) t
    WHERE
        e IS NOT NULL
"""
