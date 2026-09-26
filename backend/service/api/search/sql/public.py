def _public_search(match_percentage: str, tail: str) -> str:
    return f"""
SELECT
    prospect.id AS prospect_person_id,

    prospect.uuid AS prospect_uuid,

    prospect.url_slug,

    prospect.name,

    prospect.verification_level_id > 1 AS verified,

    (
        SELECT
            uuid
        FROM
            photo
        WHERE
            person_id = prospect.id
        ORDER BY
            position
        LIMIT 1
    ) AS profile_photo_uuid,

    (
        SELECT
            blurhash
        FROM
            photo
        WHERE
            person_id = prospect.id
        ORDER BY
            position
        LIMIT 1
    ) AS profile_photo_blurhash,

    CASE
        WHEN prospect.show_my_age
        THEN EXTRACT(YEAR FROM AGE(prospect.date_of_birth))
        ELSE NULL
    END AS age,

    {match_percentage} AS match_percentage,

    FALSE AS person_messaged_prospect,

    FALSE AS prospect_messaged_person,

    NULL AS verification_required_to_view
FROM
    person AS prospect
WHERE
    prospect.public_profile
AND
    prospect.activated
AND
    prospect.shadow_banned_at IS NULL
AND ( -- Exclude users who should be verified but aren't
        prospect.verification_level_id > 1
    OR
        NOT prospect.verification_required
)
AND
    prospect.last_online_time > now() - interval '7 days'
{tail}
"""


_SEARCH_FILTERS = """
AND (
        %(gender)s::TEXT[] IS NULL
    OR
        prospect.gender_id IN (
            SELECT id FROM gender WHERE name = ANY(%(gender)s::TEXT[])
        )
)
AND
    prospect.date_of_birth <= (
        CURRENT_DATE - INTERVAL '1 year' * COALESCE(%(min_age)s::INT, 0)
    )
AND
    prospect.date_of_birth > (
        CURRENT_DATE - INTERVAL '1 year' * (COALESCE(%(max_age)s::INT, 999) + 1)
    )
"""

Q_PUBLIC_SEARCH = _public_search(
    match_percentage="50",
    tail=_SEARCH_FILTERS + """
ORDER BY
    (
        SELECT
            count(*)
        FROM
            messaged
        WHERE
            object_person_id = prospect.id
        AND
            created_at > now() - interval '30 days'
    ) DESC,
    prospect.id
""",
)

# How well a prospect matches the answers an unauthenticated user has given so
# far
_ANSWERS_MATCH_PERCENTAGE = """
    CLAMP(
        0,
        99,
        100 * (
            1 - (prospect.personality <#> %(searcher_personality)s::vector(47))
        ) / 2
    )::SMALLINT
"""

_SIMILAR_PROFILES_TAIL = """
AND
    prospect.id != %(prospect_person_id)s
ORDER BY
    prospect.personality <#> (
        SELECT personality FROM person WHERE id = %(prospect_person_id)s
    )
LIMIT
    %(n)s
"""

Q_PUBLIC_SEARCH_WITH_ANSWERS = _public_search(
    match_percentage=_ANSWERS_MATCH_PERCENTAGE,
    tail=_SEARCH_FILTERS + """
ORDER BY
    match_percentage DESC,
    prospect.id
LIMIT
    %(n)s
OFFSET
    %(o)s
""",
)

Q_PUBLIC_SIMILAR_PROFILES = _public_search(
    match_percentage="50",
    tail=_SIMILAR_PROFILES_TAIL,
)

Q_PUBLIC_SIMILAR_PROFILES_WITH_ANSWERS = _public_search(
    match_percentage=_ANSWERS_MATCH_PERCENTAGE,
    tail=_SIMILAR_PROFILES_TAIL,
)
