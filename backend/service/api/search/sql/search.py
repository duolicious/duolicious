from serviceshared.database import Row, row_bool, row_int, row_str, row_str_or_none
from service.api.searchfilters import (
    SearchParam,
    and_clauses,
    prospect_filters,
    sql_fragment,
    two_way_filters,
)



Q_SET_SEARCH_PREFERENCE_CLUB = """
UPDATE
    search_preference
SET
    club_name = %(club_name)s::TEXT
WHERE
    person_id = %(person_id)s
AND
    %(club_name)s::TEXT IS NOT NULL
AND
    %(do_modify)s
"""



Q_APPLY_CLUB_PREFERENCE = """
WITH set_pending_club_name_to_null AS (
    UPDATE
        duo_session
    SET
        pending_club_name = NULL
    WHERE
        person_id = %(person_id)s
)
UPDATE
    search_preference
SET
    club_name = %(club_name)s::TEXT
WHERE
    person_id = %(person_id)s
AND
    %(do_modify)s
"""



Q_DELETE_SEARCH_CACHE = """
DELETE FROM
    search_cache
WHERE
    searcher_person_id = %(searcher_person_id)s
"""



_HIDE_ME = sql_fragment("""
    -- The prospect wants to be shown to strangers or isn't a stranger
    (
        prospect.id IN (
            SELECT
                subject_person_id
            FROM
                messaged
            WHERE
                object_person_id = %(searcher_person_id)s
        )
    OR
        NOT prospect.hide_me_from_strangers
    )
""")

_PROSPECT_DIDNT_SKIP_SEARCHER = sql_fragment("""
    -- The prospect did not skip the searcher
    prospect.id NOT IN (
        SELECT
            subject_person_id
        FROM
            skipped
        WHERE
            object_person_id = %(searcher_person_id)s
    )
""")

_SEARCHER_DIDNT_SKIP_PROSPECT = sql_fragment("""
    prospect.id NOT IN (
        SELECT object_person_id FROM skipped
        WHERE subject_person_id = %(searcher_person_id)s
    )
""")

_SEARCHER_DIDNT_MESSAGE_PROSPECT = sql_fragment("""
    prospect.id NOT IN (
        SELECT object_person_id FROM messaged
        WHERE subject_person_id = %(searcher_person_id)s
    )
""")

_VERIFICATION_SATISFIED = sql_fragment("""
    -- Exclude users who should be verified but aren't
    (
        prospect.verification_level_id > 1
    OR
        NOT prospect.verification_required
    )
""")

_CLUB_DISTANCE = \
    'prospect.club_vector <#> %(searcher_club_vector)s::VECTOR'


def _prospect_select(sort_by_clubs: bool) -> str:
    club_distance = _CLUB_DISTANCE if sort_by_clubs else '0::REAL'

    return f"""    SELECT
        prospect.id AS prospect_person_id,

        uuid AS prospect_uuid,

        name,

        prospect.personality,

        verification_level_id > 1 AS verified,

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

        CASE
            WHEN show_my_age
            THEN EXTRACT(YEAR FROM AGE(prospect.date_of_birth))
            ELSE NULL
        END AS age,

        CLAMP(
            0,
            99,
            100 * (1 - (prospect.personality <#> %(searcher_personality)s::VECTOR)) / 2
        ) AS match_percentage,

        {club_distance} AS club_distance"""

def _rank(sort_by_clubs: bool) -> str:
    return 'club_distance' if sort_by_clubs else 'match_percentage DESC'


def _search_cache_insert(sort_by_clubs: bool) -> str:
    return f"""), do_promote_verified AS (
    SELECT
        count(*) >= 250 AS x
    FROM
        candidates
    WHERE
        profile_photo_uuid IS NOT NULL
    AND
        verified
    AND
        %(searcher_count_answers)s > 0
)
INSERT INTO search_cache (
    searcher_person_id,
    position,
    prospect_person_id,
    prospect_uuid,
    profile_photo_uuid,
    name,
    age,
    match_percentage,
    club_distance,
    personality,
    verified
)
SELECT
    %(searcher_person_id)s,
    ROW_NUMBER() OVER (
        ORDER BY
            -- If this is changed, other subqueries will need changing too
            CASE
                WHEN (SELECT x FROM do_promote_verified)
                THEN
                    profile_photo_uuid IS NOT NULL AND verified
                ELSE
                    profile_photo_uuid IS NOT NULL
            END DESC,

            {_rank(sort_by_clubs)}
    ) AS position,
    prospect_person_id,
    prospect_uuid,
    profile_photo_uuid,
    name,
    age,
    match_percentage,
    club_distance,
    personality,
    verified
FROM
    candidates
ORDER BY
    position
LIMIT
    500
ON CONFLICT (searcher_person_id, position) DO UPDATE SET
    searcher_person_id = EXCLUDED.searcher_person_id,
    position = EXCLUDED.position,
    prospect_person_id = EXCLUDED.prospect_person_id,
    prospect_uuid = EXCLUDED.prospect_uuid,
    profile_photo_uuid = EXCLUDED.profile_photo_uuid,
    name = EXCLUDED.name,
    age = EXCLUDED.age,
    match_percentage = EXCLUDED.match_percentage,
    club_distance = EXCLUDED.club_distance,
    personality = EXCLUDED.personality,
    verified = EXCLUDED.verified
"""


def _from_clause(club_preference: str | None) -> str:
    if club_preference is None:
        return "        person AS prospect"
    return """        person AS prospect
    JOIN
        person_club
    ON
        person_club.person_id = prospect.id
    AND
        person_club.club_name = %(club_preference)s
    AND
        person_club.activated"""


def search_only_clauses(prefs: Row) -> list[str]:
    clauses = [
        'prospect.id != %(searcher_person_id)s',
        "'bot' <> ALL(prospect.roles)",
        'prospect.activated',
        'prospect.shadow_banned_at IS NULL',
    ]

    clauses.append(_HIDE_ME)
    clauses.append(_PROSPECT_DIDNT_SKIP_SEARCHER)

    if not row_bool(prefs, 'show_skipped'):
        clauses.append(_SEARCHER_DIDNT_SKIP_PROSPECT)
    if not row_bool(prefs, 'show_messaged'):
        clauses.append(_SEARCHER_DIDNT_MESSAGE_PROSPECT)

    clauses.append(_VERIFICATION_SATISFIED)

    return clauses


def build_uncached_search(
    searcher_person_id: int,
    n: int,
    o: int,
    prefs: Row,
) -> tuple[str, dict[str, SearchParam]]:
    params: dict[str, SearchParam] = dict(
        searcher_person_id=searcher_person_id,
        n=n,
        o=o,
        searcher_personality=row_str(prefs, 'searcher_personality'),
        searcher_count_answers=row_int(prefs, 'searcher_count_answers'),
    )

    club_preference = row_str_or_none(prefs, 'club_preference')
    if club_preference is not None:
        params['club_preference'] = club_preference

    sort_by_clubs = row_str(prefs, 'sort_by') == 'Similar clubs'
    if sort_by_clubs:
        params['searcher_club_vector'] = row_str(
            prefs, 'searcher_club_vector')

    reverse = two_way_filters(prefs)
    params.update(reverse.params)

    filters = prospect_filters(prefs)
    params.update(filters.params)

    where = and_clauses([
        *search_only_clauses(prefs),
        *reverse.clauses,
        *filters.clauses,
    ])

    if sort_by_clubs:
        candidate_order = _CLUB_DISTANCE
    else:
        candidate_order = \
            'prospect.personality <#> %(searcher_personality)s::VECTOR'

    sql = f"""
WITH candidates AS (
{_prospect_select(sort_by_clubs)}
    FROM
{_from_clause(club_preference)}
    WHERE
        {where}

    ORDER BY
        {candidate_order}

    LIMIT
        750
{_search_cache_insert(sort_by_clubs)}"""

    return sql, params




Q_CACHED_SEARCH = """
WITH page AS (
    SELECT
        prospect_person_id,
        prospect_uuid,
        (
            SELECT url_slug FROM person WHERE id = prospect_person_id
        ) AS url_slug,
        profile_photo_uuid,
        (
            SELECT blurhash FROM photo WHERE profile_photo_uuid = photo.uuid
        ) AS profile_photo_blurhash,
        name,
        age,
        match_percentage,
        EXISTS (
            SELECT
                1
            FROM
                messaged
            WHERE
                subject_person_id = %(searcher_person_id)s
            AND
                object_person_id = prospect_person_id
        ) AS person_messaged_prospect,
        EXISTS (
            SELECT
                1
            FROM
                messaged
            WHERE
                subject_person_id = prospect_person_id
            AND
                object_person_id = %(searcher_person_id)s
        ) AS prospect_messaged_person,
        verified,
        (
            SELECT
                verification_level_id
            FROM
                person
            WHERE
                id = %(searcher_person_id)s
        ) AS searcher_verification_level_id,
        (
            SELECT
                privacy_verification_level_id
            FROM
                person
            WHERE
                id = prospect_person_id
        ) AS privacy_verification_level_id
    FROM
        search_cache
    WHERE
        searcher_person_id = %(searcher_person_id)s AND
        position >  %(o)s AND
        position <= %(o)s + %(n)s
    ORDER BY
        position
)
SELECT
    public_page.profile_photo_blurhash,
    public_page.name,
    public_page.age,
    public_page.match_percentage,
    public_page.person_messaged_prospect,
    public_page.prospect_messaged_person,
    public_page.verified,
    public_page.verification_required_to_view,

    private_page.prospect_person_id,
    private_page.prospect_uuid,
    private_page.url_slug,
    private_page.profile_photo_uuid
FROM
    (
        SELECT
            *,

            CASE
                WHEN
                    searcher_verification_level_id >=
                    privacy_verification_level_id
                THEN NULL
                WHEN
                    privacy_verification_level_id = 2
                THEN 'basics'
                WHEN
                    privacy_verification_level_id = 3
                THEN 'photos'
            END AS verification_required_to_view
        FROM
            page
    ) AS public_page
LEFT JOIN
    (
        SELECT
            *
        FROM
            page
        WHERE
            searcher_verification_level_id >= privacy_verification_level_id
    ) AS private_page
ON
    private_page.prospect_person_id = public_page.prospect_person_id
"""

Q_SORT_BY_CLUBS = """
SELECT
    sort_by.name = 'Similar clubs' AS sort_by_clubs
FROM
    search_preference
JOIN
    sort_by
ON
    sort_by.id = search_preference.sort_by_id
WHERE
    search_preference.person_id = %(searcher_person_id)s
"""


def build_quiz_search(sort_by_clubs: bool) -> str:
    return f"""
WITH searcher AS (
    SELECT
        personality,
        count_answers
    FROM
        person
    WHERE
        person.id = %(searcher_person_id)s
), do_promote_verified AS (
    SELECT
        count(*) >= 250 AS x
    FROM
        search_cache,
        searcher
    WHERE
        searcher_person_id = %(searcher_person_id)s
    AND
        profile_photo_uuid IS NOT NULL
    AND
        verified
    AND
        (SELECT count_answers > 0 FROM searcher)
), page AS (
    SELECT
        prospect_person_id,
        prospect_uuid,
        (
            SELECT url_slug FROM person WHERE id = prospect_person_id
        ) AS url_slug,
        profile_photo_uuid,
        (
            SELECT blurhash FROM photo WHERE profile_photo_uuid = photo.uuid
        ) AS profile_photo_blurhash,
        name,
        age,
        CLAMP(
            0,
            99,
            100 * (1 - (personality <#> (SELECT personality FROM searcher))) / 2
        )::SMALLINT AS match_percentage,
        (
            SELECT
                verification_level_id
            FROM
                person
            WHERE
                id = %(searcher_person_id)s
        ) AS searcher_verification_level_id,
        (
            SELECT
                privacy_verification_level_id
            FROM
                person
            WHERE
                id = prospect_person_id
        ) AS privacy_verification_level_id
    FROM
        search_cache
    WHERE
        searcher_person_id = %(searcher_person_id)s
    ORDER BY
        -- If this is changed, other subqueries will need changing too
        CASE
            WHEN (SELECT x FROM do_promote_verified)
            THEN
                profile_photo_uuid IS NOT NULL AND verified
            ELSE
                profile_photo_uuid IS NOT NULL
        END DESC,

        {_rank(sort_by_clubs)}
    LIMIT
        1
)
SELECT
    public_page.profile_photo_blurhash,
    public_page.name,
    public_page.age,
    public_page.match_percentage,
    public_page.verification_required_to_view,

    private_page.prospect_person_id,
    private_page.prospect_uuid,
    private_page.url_slug,
    private_page.profile_photo_uuid
FROM
    (
        SELECT
            *,

            CASE
                WHEN
                    searcher_verification_level_id >=
                    privacy_verification_level_id
                THEN NULL
                WHEN
                    privacy_verification_level_id = 2
                THEN 'basics'
                WHEN
                    privacy_verification_level_id = 3
                THEN 'photos'
            END AS verification_required_to_view
        FROM
            page
    ) AS public_page
LEFT JOIN
    (
        SELECT
            *
        FROM
            page
        WHERE
            searcher_verification_level_id >= privacy_verification_level_id
    ) AS private_page
ON
    private_page.prospect_person_id = public_page.prospect_person_id
"""

