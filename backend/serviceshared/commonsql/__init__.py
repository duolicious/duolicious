from serviceshared.gold.sql import has_gold_sql
from typing import Literal

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

CLUB_VECTOR_ASSIGNMENT = """
    club_vector = COALESCE(
        (
            SELECT l2_normalize(SUM(club.embedding))
            FROM person_club
            JOIN club
            ON club.name = person_club.club_name
            WHERE person_club.person_id = person.id
        ),
        array_full(64, 0)::VECTOR(64)
    ),
    club_vector_computed_at = NOW()
"""


def _q_refresh_club_vector(where: str) -> str:
    return f"""
UPDATE
    person
SET
{CLUB_VECTOR_ASSIGNMENT}
WHERE
    {where}
"""


Q_REFRESH_CLUB_VECTOR = _q_refresh_club_vector('id = %(person_id)s')

Q_UPDATE_LAST = """
UPDATE
    person
SET
    last_online_time = NOW()
WHERE
    uuid = %(person_uuid)s
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

def notification_due_sql(
    kind: Literal['intro', 'chat', 'visitor'],
    events: str,
) -> str:
    return f"""
    INSERT INTO notification_due (person_id, kind, event_at, due_at)
    SELECT
        person.id,
        '{kind}'::notification_kind,
        event.at,
        GREATEST(
            event.at + INTERVAL '10 minutes',
            to_timestamp(person.{kind}_seconds + CASE immediacy.name
                WHEN 'Daily'        THEN 86400
                WHEN 'Every 3 days' THEN 259200
                WHEN 'Weekly'       THEN 604800
                ELSE                     0
            END)
        )
    FROM (
        SELECT person_id, MAX(at) AS at
        FROM ({events}) AS event(person_id, at)
        GROUP BY person_id
    ) AS event
    JOIN person
    ON person.id = event.person_id
    JOIN immediacy
    ON immediacy.id = person.{kind}s_notification
    WHERE immediacy.name <> 'Never'
    ORDER BY person.id
    ON CONFLICT (person_id, kind) DO UPDATE SET
        event_at = EXCLUDED.event_at,
        due_at = EXCLUDED.due_at
    WHERE EXCLUDED.event_at >= notification_due.event_at
    """

def reschedule_notification_sql(
    kind: Literal['intro', 'chat', 'visitor'],
    person_id: str,
) -> str:
    return notification_due_sql(kind, f"""
        SELECT person_id, event_at
        FROM notification_due
        WHERE kind = '{kind}' AND person_id = {person_id}
        FOR UPDATE
    """)

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

def computed_flair_sql(person: str) -> str:
    return f"""
    SELECT
        COALESCE(
            array_agg(DISTINCT e ORDER BY e),
            ARRAY[]::TEXT[]
        ) AS computed_flair
    FROM (
        SELECT
            unnest(flair) AS e
        UNION
            SELECT 'gold' WHERE {has_gold_sql(f'{person}.id')}
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

Q_PATCH_PHOTO = """
WITH existing_uuid AS (
    SELECT
        uuid
    FROM
        photo
    WHERE
        person_id = %(person_id)s
    AND
        position = %(position)s
), undeleted_photo_insertion AS (
    INSERT INTO undeleted_photo (
        uuid
    )
    SELECT
        uuid
    FROM
        existing_uuid
), photo_insertion AS (
    INSERT INTO photo (
        person_id,
        position,
        uuid,
        blurhash,
        extra_exts,
        hash,
        width,
        height,
        crop_top,
        crop_left,
        nsfw_score_v2,
        duration_seconds
    ) VALUES (
        %(person_id)s,
        %(position)s,
        %(uuid)s,
        %(blurhash)s,
        %(extra_exts)s,
        %(hash)s,
        %(width)s,
        %(height)s,
        %(crop_top)s,
        %(crop_left)s,
        %(nsfw_score_v2)s,
        %(duration_seconds)s
    ) ON CONFLICT (person_id, position) DO UPDATE SET
        uuid = EXCLUDED.uuid,
        blurhash = EXCLUDED.blurhash,
        extra_exts = EXCLUDED.extra_exts,
        hash = EXCLUDED.hash,
        width = EXCLUDED.width,
        height = EXCLUDED.height,
        crop_top = EXCLUDED.crop_top,
        crop_left = EXCLUDED.crop_left,
        nsfw_score_v2 = EXCLUDED.nsfw_score_v2,
        duration_seconds = EXCLUDED.duration_seconds,
        verified = FALSE
), updated_person AS (
    UPDATE person
    SET
        last_event_time = now(),
        last_event_name = 'added-photo',
        last_event_data = jsonb_build_object(
            'added_photo_uuid', %(uuid)s,
            'added_photo_blurhash', %(blurhash)s,
            'added_photo_extra_exts', %(extra_exts)s::TEXT[]
        )
    WHERE
        id = %(person_id)s
)
SELECT 1
"""

def visitors_tab_shows_sql(prospect: str, checker_id: str) -> str:
    return f"""
        {prospect}.activated
    AND
        {prospect}.shadow_banned_at IS NULL
    AND
        {prospect}.id <> {checker_id}
    AND
        -- The prospect did not skip the checker
        NOT EXISTS (
            SELECT
                1
            FROM
                skipped
            WHERE
                subject_person_id = {prospect}.id
            AND
                object_person_id = {checker_id}
        )
    AND
        -- The checker did not skip the prospect, or wishes to view skipped prospects
        (
            NOT EXISTS (
                SELECT
                    1
                FROM
                    skipped
                WHERE
                    subject_person_id = {checker_id}
                AND
                    object_person_id = {prospect}.id
            )
        OR
            EXISTS (
                SELECT
                    1
                FROM
                    search_preference
                WHERE
                    person_id = {checker_id}
                AND
                    show_skipped
            )
        )
    AND
        -- The prospect wants to be shown to strangers or isn't a stranger
        (
            EXISTS (
                SELECT
                    subject_person_id
                FROM
                    messaged
                WHERE
                    subject_person_id = {prospect}.id
                AND
                    object_person_id = {checker_id}
            )
        OR
            NOT {prospect}.hide_me_from_strangers
        OR
            {prospect}.public_profile
        )
    AND
        {prospect}.verification_level_id >=
            {prospect}.required_verification_level_id
"""
