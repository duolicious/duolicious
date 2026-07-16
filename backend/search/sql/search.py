"""
SQL for the `/search` endpoint: search-preference upserts, the uncached
search that (re)builds `search_cache`, and the cached/quiz reads of it.
"""

from database import Row, row_bool, row_int, row_str, row_str_or_none
from searchfilters import SearchParam, prospect_filters



Q_UPSERT_SEARCH_PREFERENCE_CLUB = """
INSERT INTO search_preference_club (
    person_id,
    club_name
)
SELECT
    %(person_id)s,
    %(club_name)s::TEXT
WHERE
    %(club_name)s::TEXT IS NOT NULL
AND
    %(do_modify)s
ON CONFLICT (person_id) DO UPDATE SET
    club_name = EXCLUDED.club_name
"""



Q_SEARCH_PREFERENCE = f"""
WITH delete_search_preference_club AS (
    DELETE FROM
        search_preference_club
    WHERE
        person_id = %(person_id)s
    AND
        %(club_name)s::TEXT IS NULL
    AND
        %(do_modify)s
), set_pending_club_name_to_null AS (
    UPDATE
        duo_session
    SET
        pending_club_name = NULL
    WHERE
        person_id = %(person_id)s
), upsert_search_preference_club AS (
    {Q_UPSERT_SEARCH_PREFERENCE_CLUB}
)
SELECT
    gender_id
FROM
    search_preference_gender
WHERE
    person_id = %(person_id)s
"""



Q_DELETE_SEARCH_CACHE = """
DELETE FROM
    search_cache
WHERE
    searcher_person_id = %(searcher_person_id)s
"""



_REVERSE_GENDER_EXISTS = """EXISTS (
            SELECT
                1
            FROM
                search_preference_gender AS preference
            WHERE
                preference.person_id = prospect.id
            AND
                preference.gender_id = %(searcher_gender_id)s
        )"""

_HIDE_ME = """-- The prospect wants to be shown to strangers or isn't a stranger
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
        )"""

_PROSPECT_DIDNT_SKIP_SEARCHER = """-- The prospect did not skip the searcher
        prospect.id NOT IN (
            SELECT
                subject_person_id
            FROM
                skipped
            WHERE
                object_person_id = %(searcher_person_id)s
        )"""

_VERIFICATION_SATISFIED = """-- Exclude users who should be verified but aren't
        (
            prospect.verification_level_id > 1
        OR
            NOT prospect.verification_required
        )"""

_PROSPECT_SELECT = """    SELECT
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

        roles"""

_SEARCH_CACHE_INSERT = """), do_promote_verified AS (
    SELECT
        count(*) >= 250 AS x
    FROM
        prospects
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

            match_percentage DESC
    ) AS position,
    prospect_person_id,
    prospect_uuid,
    profile_photo_uuid,
    name,
    age,
    match_percentage,
    personality,
    verified
FROM
    prospects
WHERE
    prospects.prospect_person_id != %(searcher_person_id)s
AND
    'bot' <> ALL(prospects.roles)
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
    personality = EXCLUDED.personality,
    verified = EXCLUDED.verified
"""


def _from_clause(club_preference: str | None) -> str:
    """
    What the single candidate scan reads. `person_club` supplies club
    membership only; every filter reads `person`, whose row the scan is already
    on, so the denormalized copies on `person_club` aren't needed.
    """
    if club_preference is None:
        return "        person AS prospect"
    # `person_club.activated` is redundant with `prospect.activated` (a trigger
    # keeps them equal), but naming it here is what lets the partial index
    # `idx__person_club__activated__club_name__person_id` (WHERE activated)
    # apply; without it the club path sequentially scans all of `person_club`.
    return """        person AS prospect
    JOIN
        person_club
    ON
        person_club.person_id = prospect.id
    AND
        person_club.club_name = %(club_preference)s
    AND
        person_club.activated"""


def build_uncached_search(
    searcher_person_id: int,
    n: int,
    o: int,
    prefs: Row,
) -> tuple[str, dict[str, SearchParam]]:
    """
    Assemble the uncached search and its bound parameters from `prefs` (one
    `Q_SEARCH_PARAMETERS` row): the filters `searchfilters.prospect_filters`
    shares with the inbox, plus the ones only a search applies.
    """
    # `max_last_online_seconds` and `searcher_coordinates` are bound by
    # `prospect_filters` below, alongside the clauses that read them.
    params: dict[str, SearchParam] = dict(
        searcher_person_id=searcher_person_id,
        n=n,
        o=o,
        searcher_personality=row_str(prefs, 'searcher_personality'),
        searcher_gender_id=row_int(prefs, 'searcher_gender_id'),
        searcher_count_answers=row_int(prefs, 'searcher_count_answers'),
    )

    club_preference = row_str_or_none(prefs, 'club_preference')
    if club_preference is not None:
        params['club_preference'] = club_preference

    filters = prospect_filters(prefs)
    params.update(filters.params)

    clauses = [
        "prospect.activated",
        "prospect.shadow_banned_at IS NULL",
        *filters.clauses,
    ]

    # The searcher meets the prospect's gender preference. When searching a
    # club this is not required (the shared club is the connection), so the
    # whole clause drops out.
    if club_preference is None:
        clauses.append(_REVERSE_GENDER_EXISTS)

    clauses.append(_HIDE_ME)
    clauses.append(_PROSPECT_DIDNT_SKIP_SEARCHER)

    # The searcher did not skip / message the prospect, unless they've asked to
    # see skipped / messaged people.
    if not row_bool(prefs, 'show_skipped'):
        clauses.append(
            "prospect.id NOT IN (\n"
            "            SELECT object_person_id FROM skipped\n"
            "            WHERE subject_person_id = %(searcher_person_id)s\n"
            "        )"
        )
    if not row_bool(prefs, 'show_messaged'):
        clauses.append(
            "prospect.id NOT IN (\n"
            "            SELECT object_person_id FROM messaged\n"
            "            WHERE subject_person_id = %(searcher_person_id)s\n"
            "        )"
        )

    clauses.append(_VERIFICATION_SATISFIED)

    where = '\n    AND\n        '.join(clauses)

    # A single scan of `person`: every filter is applied here, so the ORDER BY
    # can index-scan `idx__person__personality` and the scan filters as it
    # goes. 502 rather than 500 leaves room for the searcher and the moderation
    # bot, which the INSERT below drops.
    sql = f"""
WITH prospects AS (
{_PROSPECT_SELECT}
    FROM
{_from_clause(club_preference)}
    WHERE
        {where}

    ORDER BY
        prospect.personality <#> %(searcher_personality)s::VECTOR

    LIMIT
        502
{_SEARCH_CACHE_INSERT}"""

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

Q_QUIZ_SEARCH = f"""
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

        match_percentage DESC
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

