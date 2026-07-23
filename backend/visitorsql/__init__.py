_CHECKER = """
checker AS (
    SELECT
        id,
        personality,
        last_visitor_check_time,
        verification_level_id
    FROM
        person
    WHERE
        id = %(person_id)s
)
"""

_VISITED_PASS_3 = """
visited_pass_3 AS (
    SELECT
        direction.kind AS direction_kind,

        prospect.uuid AS person_uuid,

        prospect.url_slug AS url_slug,

        visitor_photo.blurhash AS photo_blurhash,

        visitor_photo.uuid AS photo_uuid,

        iso8601_utc(visited_pass_2.updated_at) AS time,

        prospect.name AS name,

        (
            SELECT EXTRACT(YEAR FROM AGE(prospect.date_of_birth))
            WHERE prospect.show_my_age
        ) AS age,

        gender.name AS gender,

        CASE show_my_location.name
            WHEN 'Yes' THEN prospect.location_short_friendly
            WHEN 'Country only' THEN prospect.location_country
            ELSE NULL
        END AS location,

        prospect.verification_level_id > 1 AS is_verified,

        -- Ads have been removed; this is kept as a constant so existing native
        -- clients (which validate this field) keep working without the DB
        -- spending time computing it.
        FALSE AS advertiser_friendly,

        CLAMP(
            0,
            99,
            100 * (1 - (prospect.personality <#> checker.personality)) / 2
        )::SMALLINT AS match_percentage,

        CASE
            WHEN direction.kind = 'visited_you'
            THEN visited_pass_2.updated_at > checker.last_visitor_check_time
            ELSE FALSE
        END AS is_new,

        verification_required_to_view,

        visited_pass_2.updated_at AS order_time,

        visited_pass_2.invisible AS was_invisible
    FROM
        visited_pass_2
    JOIN
        person AS prospect
    ON
        prospect.id = visited_pass_2.other_person_id
    JOIN
        yes_country_only_no AS show_my_location
    ON
        show_my_location.id = prospect.show_my_location_id
    LEFT JOIN
        gender
    ON
        gender.id = prospect.gender_id
    LEFT JOIN
        checker
    ON
        TRUE
    LEFT JOIN LATERAL (
        SELECT
            CASE
                WHEN visited_pass_2.subject_person_id = %(person_id)s
                THEN 'you_visited'
                ELSE 'visited_you'
            END AS kind
    ) AS direction
    ON
        TRUE
    LEFT JOIN LATERAL (
        SELECT
            CASE
                WHEN
                    checker.verification_level_id >=
                    prospect.privacy_verification_level_id
                THEN NULL
                WHEN
                    prospect.privacy_verification_level_id = 2
                THEN 'basics'
                WHEN
                    prospect.privacy_verification_level_id = 3
                THEN 'photos'
            END AS verification_required_to_view
        FROM
            checker
    ) AS verification_required_to_view
    ON
        TRUE
    LEFT JOIN LATERAL (
        SELECT
            CASE
                WHEN verification_required_to_view IS NULL
                THEN photo.uuid
                ELSE NULL
            END AS uuid,
            photo.blurhash
        FROM
            photo
        WHERE
            photo.person_id = prospect.id
        ORDER BY
            photo.position
        LIMIT 1
    ) AS visitor_photo
    ON
        TRUE
    WHERE
        prospect.activated
    AND
        prospect.shadow_banned_at IS NULL
    AND
        prospect.id <> %(person_id)s
    AND
        -- The prospect did not skip the checker
        NOT EXISTS (
            SELECT
                1
            FROM
                skipped
            WHERE
                subject_person_id = prospect.id
            AND
                object_person_id = %(person_id)s
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
                    subject_person_id = %(person_id)s
                AND
                    object_person_id = prospect.id
            )
        OR
            1 = (
                SELECT
                    skipped_id
                FROM
                    search_preference_skipped
                WHERE
                    person_id = %(person_id)s
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
                    subject_person_id = prospect.id
                AND
                    object_person_id = %(person_id)s
            )
        OR
            NOT prospect.hide_me_from_strangers
        )
    AND
        (
            direction.kind = 'you_visited'
        OR
            NOT visited_pass_2.invisible
        )
    AND
        (
            NOT prospect.verification_required
        OR
            prospect.verification_level_id > 1
        )
)
"""

def _visited_pass_2(source: str) -> str:
    return f"""
visited_pass_2 AS (
    SELECT
        *,
        CASE
            WHEN subject_person_id = %(person_id)s
            THEN object_person_id
            ELSE subject_person_id
        END AS other_person_id
    FROM
        {source}
)
"""


_RECENT_VISITS = """
    (
        SELECT
            *
        FROM
            visited
        WHERE
            subject_person_id = %(person_id)s
        ORDER BY
            updated_at DESC
        LIMIT
            150
    )
    UNION ALL
    (
        SELECT
            *
        FROM
            visited
        WHERE
            object_person_id = %(person_id)s
        ORDER BY
            updated_at DESC
        LIMIT
            150
    )
"""


_SINGLE_VISIT = """
    visited
    WHERE
        subject_person_id = %(subject_person_id)s
    AND
        object_person_id = %(object_person_id)s
"""


Q_VISITORS = f"""
WITH {_CHECKER}, visited_pass_1 AS ({_RECENT_VISITS}
), {_visited_pass_2('visited_pass_1')}, {_VISITED_PASS_3}
SELECT
    json_build_object(
        'visited_you',
        COALESCE(
            jsonb_agg(
                (
                    to_jsonb(visited_pass_3)
                    - 'order_time'
                    - 'direction_kind'
                ) ORDER BY visited_pass_3.order_time DESC
            ) FILTER (WHERE direction_kind = 'visited_you'),
            '[]'::jsonb
        ),

        'you_visited',
        COALESCE(
            jsonb_agg(
                (
                    to_jsonb(visited_pass_3)
                    - 'order_time'
                    - 'direction_kind'
                ) ORDER BY visited_pass_3.order_time DESC
            ) FILTER (WHERE direction_kind = 'you_visited'),
            '[]'::jsonb
        ),

        'last_visited_at',
        iso8601_utc(MAX(visited_pass_3.order_time))
    ) AS j
FROM
    visited_pass_3
"""

Q_VISITOR_ITEM = f"""
WITH {_CHECKER}, {_visited_pass_2(_SINGLE_VISIT)}, {_VISITED_PASS_3}
SELECT
    (
        to_jsonb(visited_pass_3)
        - 'order_time'
        - 'direction_kind'
    ) AS j
FROM
    visited_pass_3
LIMIT 1
"""

Q_MARK_VISITORS_CHECKED = """
UPDATE
    person
SET
    last_visitor_check_time = GREATEST(
        LEAST(
            COALESCE(%(when)s::timestamp, NOW()),
            NOW()
        ),
        last_visitor_check_time
    )
WHERE
    id = %(person_id)s
"""
