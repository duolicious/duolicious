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


Q_PUBLIC_SEARCH = _public_search(
    match_percentage="50",
    tail="""
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

# Like `Q_PUBLIC_SEARCH`, but ranks public profiles by how well they match the
# answers an unauthenticated user has given so far
Q_PUBLIC_SEARCH_WITH_ANSWERS = _public_search(
    match_percentage="""
    CLAMP(
        0,
        99,
        100 * (
            1 - (prospect.personality <#> %(searcher_personality)s::vector(47))
        ) / 2
    )::SMALLINT
""",
    tail="""
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
    tail="""
AND
    prospect.id != %(prospect_person_id)s
ORDER BY
    prospect.personality <#> (
        SELECT personality FROM person WHERE id = %(prospect_person_id)s
    )
LIMIT
    %(n)s
""",
)
