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
AND -- Exclude users who should be verified but aren't
    prospect.verification_level_id >= prospect.required_verification_level_id
AND
    prospect.last_online_time > now() - interval '7 days'
AND
    NOT EXISTS (
        SELECT
            1
        FROM
            photo
        WHERE
            person_id = prospect.id
        AND
            nsfw_score_v2 > 0.5
    )
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

_POPULARITY = """
    (
        SELECT
            count(*)
        FROM
            messaged
        WHERE
            object_person_id = prospect.id
        AND
            created_at > now() - interval '30 days'
    ) DESC
"""


def _order_by(rank: str, balance_genders: bool) -> str:
    if not balance_genders:
        return f"ORDER BY {rank}, prospect.id"

    return f"""
WINDOW
    by_rank AS (ORDER BY {rank}, prospect.id),
    by_gender AS (PARTITION BY prospect.gender_id ORDER BY {rank}, prospect.id)
ORDER BY
    CASE
        WHEN prospect.gender_id IN (
            SELECT id FROM gender WHERE name IN ('Man', 'Woman')
        )
        THEN row_number() OVER by_gender
        ELSE row_number() OVER by_rank / 2.0
    END,
    {rank},
    prospect.id
"""


Q_PUBLIC_SEARCH = {
    balance_genders: _public_search(
        match_percentage="50",
        tail=_SEARCH_FILTERS + _order_by(_POPULARITY, balance_genders),
    )
    for balance_genders in (False, True)
}

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

Q_PUBLIC_SEARCH_WITH_ANSWERS = {
    balance_genders: _public_search(
        match_percentage=_ANSWERS_MATCH_PERCENTAGE,
        tail=_SEARCH_FILTERS + _order_by(
            f"{_ANSWERS_MATCH_PERCENTAGE} DESC",
            balance_genders,
        ) + """
LIMIT
    %(n)s
OFFSET
    %(o)s
""",
    )
    for balance_genders in (False, True)
}

Q_PUBLIC_SIMILAR_PROFILES = _public_search(
    match_percentage="50",
    tail=_SIMILAR_PROFILES_TAIL,
)

Q_PUBLIC_SIMILAR_PROFILES_WITH_ANSWERS = _public_search(
    match_percentage=_ANSWERS_MATCH_PERCENTAGE,
    tail=_SIMILAR_PROFILES_TAIL,
)
