from typing import Literal, TypeAlias, get_args

from pgvector import HalfVector

from serviceshared.database import (
    Row,
    row_bool,
    row_halfvec,
    row_int,
    row_int_or_none,
    row_str,
    row_str_or_none,
    row_vector,
)
from serviceshared.kvmatching.encoder import searcher_vector
from service.api.duotypes import SortBy
from service.api.searchfilters import (
    ProspectFilters,
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
AND
    club_name IS DISTINCT FROM %(club_name)s::TEXT
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
    OR
        prospect.public_profile
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

_REPLY_RATE_PRIOR_REPLIES = 0.5
_REPLY_RATE_PRIOR_INTROS = 1.5625

_REPLY_RATE_AT_LEAST = sql_fragment(f"""
    100 * (prospect.count_intros_received_with_reply + {_REPLY_RATE_PRIOR_REPLIES})
    >=
    %(min_reply_percentage)s * (prospect.count_intros_received + {_REPLY_RATE_PRIOR_INTROS})
""")

_VISIBLE_TO_SEARCHER = [
    'prospect.id != %(searcher_person_id)s',
    "'bot' <> ALL(prospect.roles)",
    'prospect.activated',
    'prospect.shadow_banned_at IS NULL',
    _HIDE_ME,
    _PROSPECT_DIDNT_SKIP_SEARCHER,
    _VERIFICATION_SATISFIED,
]


def _verification_required_to_view(
    searcher_level: str,
    privacy_level: str,
) -> str:
    return f"""CASE
                WHEN {searcher_level} >= {privacy_level} THEN NULL
                WHEN {privacy_level} = 2 THEN 'basics'
                WHEN {privacy_level} = 3 THEN 'photos'
            END"""


Q_SEARCHER = """
SELECT
    kv_vector,
    personality,
    verification_level_id
FROM
    person
WHERE
    id = %(searcher_person_id)s
"""

CLUB_CARD_MEMBERS = 25

_CLUB_MEMBER_CLAUSES = [
    'person_club.club_name = %(club_name)s',
    'person_club.activated',
    *_VISIBLE_TO_SEARCHER,
    _SEARCHER_DIDNT_SKIP_PROSPECT,
]

_CLUB_MEMBER_GENDER_RANKS = [
    'prospect.gender_id <> ALL(searcher.gender_ids)',
    'searcher.two_way_gender'
    ' AND searcher.gender_id <> ALL(prospect_preference.gender_ids)',
]

_CLUB_MEMBER_ACTIVE = "prospect.last_online_time > NOW() - INTERVAL '30 days'"

_CLUB_MEMBER_DISTANCE = 'prospect.coordinates <-> searcher.coordinates'


def _q_club_members(clauses: list[str], order_by: list[str]) -> str:
    return f"""
SELECT
    prospect.uuid AS person_uuid,
    prospect.url_slug,
    prospect.name,
    (
        SELECT EXTRACT(YEAR FROM AGE(prospect.date_of_birth))
        WHERE prospect.show_my_age
    ) AS age,
    gender.name AS gender,
    CASE show_my_location.name
        WHEN 'Yes' THEN prospect.location_short_friendly
        WHEN 'Country only' THEN prospect.location_country
    END AS location,
    prospect.verification_level_id > 1 AS is_verified,
    CLAMP(
        0,
        99,
        100 * (1 - (prospect.personality <#> %(searcher_personality)s)) / 2
    )::SMALLINT AS match_percentage,
    {_verification_required_to_view(
        '%(searcher_verification_level_id)s',
        'prospect.privacy_verification_level_id')} AS verification_required_to_view,
    (
        SELECT uuid FROM photo
        WHERE person_id = prospect.id
        AND %(searcher_verification_level_id)s >= prospect.privacy_verification_level_id
        ORDER BY position LIMIT 1
    ) AS photo_uuid,
    (
        SELECT blurhash FROM photo
        WHERE person_id = prospect.id
        ORDER BY position LIMIT 1
    ) AS photo_blurhash
FROM
    person_club
JOIN
    person AS prospect
ON
    prospect.id = person_club.person_id
JOIN
    yes_country_only_no AS show_my_location
ON
    show_my_location.id = prospect.show_my_location_id
LEFT JOIN
    gender
ON
    gender.id = prospect.gender_id
LEFT JOIN (
    SELECT
        person.gender_id,
        person.coordinates,
        search_preference.gender_ids,
        search_preference.two_way_gender
    FROM
        person
    JOIN
        search_preference
    ON
        search_preference.person_id = person.id
    WHERE
        person.id = %(searcher_person_id)s
) AS searcher
ON
    TRUE
LEFT JOIN
    search_preference AS prospect_preference
ON
    prospect_preference.person_id = prospect.id
WHERE
{and_clauses(clauses)}
ORDER BY
    {', '.join(order_by)}
LIMIT
    {CLUB_CARD_MEMBERS}
"""


Q_CLUB_MEMBERS = _q_club_members(
    _CLUB_MEMBER_CLAUSES,
    [
        *_CLUB_MEMBER_GENDER_RANKS,
        f'NOT ({_CLUB_MEMBER_ACTIVE})',
        _CLUB_MEMBER_DISTANCE,
    ],
)

Q_CLUB_MEMBERS_FIRST_RANK = _q_club_members(
    [
        *_CLUB_MEMBER_CLAUSES,
        _CLUB_MEMBER_ACTIVE,
        *(f'({rank}) IS FALSE' for rank in _CLUB_MEMBER_GENDER_RANKS),
    ],
    [_CLUB_MEMBER_DISTANCE],
)

_SORT_BYS: tuple[SortBy, ...] = get_args(SortBy)
SORT_MATCH_PERCENTAGE, SORT_CLUBS, SORT_KV, SORT_DISTANCE = _SORT_BYS

_SortColumn: TypeAlias = Literal['personality', 'club_vector', 'kv_vector']

_Sort: TypeAlias = tuple[str, dict[str, SearchParam]]


def _saved_sort_by(prefs: Row) -> SortBy:
    saved = row_str(prefs, 'sort_by')
    for sort_by in _SORT_BYS:
        if sort_by == saved:
            return sort_by
    raise ValueError('invalid sort_by value')


def kv_query_vector(stored: HalfVector) -> HalfVector:
    return HalfVector(searcher_vector(stored.to_numpy()))


def _vector_sort(column: _SortColumn, vector: SearchParam) -> _Sort:
    return f'prospect.{column} <#> %(sort_vector)s', dict(sort_vector=vector)


def _sort(sort_by: SortBy, prefs: Row) -> _Sort:
    if sort_by == SORT_MATCH_PERCENTAGE:
        return _vector_sort(
            'personality', row_vector(prefs, 'searcher_personality'))
    if sort_by == SORT_CLUBS:
        return _vector_sort(
            'club_vector', row_vector(prefs, 'searcher_club_vector'))
    if sort_by == SORT_KV:
        return _vector_sort(
            'kv_vector', kv_query_vector(row_halfvec(prefs, 'searcher_kv_vector')))
    if sort_by == SORT_DISTANCE:
        return (
            'prospect.coordinates <-> %(searcher_coordinates)s::GEOGRAPHY',
            dict(searcher_coordinates=row_str(prefs, 'searcher_coordinates')),
        )
    raise ValueError('invalid sort_by value')


def _prospect_select(sort_expression: str) -> str:
    return f"""    SELECT
        prospect.id AS prospect_person_id,

        verification_level_id > 1 AS verified,

        EXISTS (
            SELECT 1 FROM photo WHERE person_id = prospect.id
        ) AS has_photo,

        {sort_expression} AS sort_distance"""

_RANKED_PROSPECT_IDS = """), do_promote_verified AS (
    SELECT
        count(*) >= 250 AS x
    FROM
        candidates
    WHERE
        has_photo
    AND
        verified
    AND
        %(searcher_count_answers)s > 0
)
SELECT
    prospect_person_id
FROM
    candidates
ORDER BY
    -- If this is changed, other subqueries will need changing too
    CASE
        WHEN (SELECT x FROM do_promote_verified)
        THEN
            has_photo AND verified
        ELSE
            has_photo
    END DESC,

    sort_distance
LIMIT
    500
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


def search_only_filters(prefs: Row) -> ProspectFilters:
    clauses = list(_VISIBLE_TO_SEARCHER)
    params: dict[str, SearchParam] = {}

    if not row_bool(prefs, 'show_skipped'):
        clauses.append(_SEARCHER_DIDNT_SKIP_PROSPECT)
    if not row_bool(prefs, 'show_messaged'):
        clauses.append(_SEARCHER_DIDNT_MESSAGE_PROSPECT)

    min_reply_percentage = row_int_or_none(prefs, 'min_reply_percentage')
    if min_reply_percentage is not None:
        params['min_reply_percentage'] = min_reply_percentage
        clauses.append(_REPLY_RATE_AT_LEAST)

    return ProspectFilters(clauses=clauses, params=params)


def build_uncached_search(
    searcher_person_id: int,
    prefs: Row,
    ignore_sort_preference: bool,
) -> tuple[str, dict[str, SearchParam]]:
    params: dict[str, SearchParam] = dict(
        searcher_person_id=searcher_person_id,
        searcher_count_answers=row_int(prefs, 'searcher_count_answers'),
    )

    club_preference = row_str_or_none(prefs, 'club_preference')
    if club_preference is not None:
        params['club_preference'] = club_preference

    sort_by = (SORT_MATCH_PERCENTAGE if ignore_sort_preference
               else _saved_sort_by(prefs))
    sort_expression, sort_params = _sort(sort_by, prefs)
    params.update(sort_params)

    search_only = search_only_filters(prefs)
    params.update(search_only.params)

    reverse = two_way_filters(prefs)
    params.update(reverse.params)

    filters = prospect_filters(prefs)
    params.update(filters.params)

    where = and_clauses([
        *search_only.clauses,
        *reverse.clauses,
        *filters.clauses,
    ])

    sql = f"""
WITH candidates AS (
{_prospect_select(sort_expression)}
    FROM
{_from_clause(club_preference)}
    WHERE
        {where}

    ORDER BY
        sort_distance

    LIMIT
        750
{_RANKED_PROSPECT_IDS}"""

    return sql, params




def _cached_search(selection: str) -> str:
    return f"""
WITH searcher AS (
    SELECT
        personality,
        verification_level_id,
        count_answers,
        show_skipped
    FROM
        person
    JOIN
        search_preference
    ON
        search_preference.person_id = person.id
    WHERE
        id = %(searcher_person_id)s
), cached AS (
    SELECT
        ranked.position,
        prospect.id AS prospect_person_id,
        prospect.uuid AS prospect_uuid,
        prospect.url_slug,
        prospect.personality,
        profile_photo.uuid AS profile_photo_uuid,
        profile_photo.blurhash AS profile_photo_blurhash,
        prospect.name,
        (
            CASE
                WHEN prospect.show_my_age
                THEN EXTRACT(YEAR FROM AGE(prospect.date_of_birth))
            END
        )::SMALLINT AS age,
        CLAMP(
            0,
            99,
            100 * (1 - (prospect.personality <#> searcher.personality)) / 2
        )::SMALLINT AS match_percentage,
        prospect.verification_level_id > 1 AS verified,
        searcher.verification_level_id AS searcher_verification_level_id,
        prospect.privacy_verification_level_id
    FROM
        searcher
    CROSS JOIN
        unnest(%(prospect_person_ids)s::INT[])
            WITH ORDINALITY AS ranked(prospect_person_id, position)
    JOIN
        person AS prospect
    ON
        prospect.id = ranked.prospect_person_id
    LEFT JOIN LATERAL (
        SELECT
            uuid,
            blurhash
        FROM
            photo
        WHERE
            person_id = prospect.id
        ORDER BY
            position
        LIMIT 1
    ) AS profile_photo
    ON
        TRUE
    WHERE
        {_PROSPECT_DIDNT_SKIP_SEARCHER}
    AND
        (searcher.show_skipped OR {_SEARCHER_DIDNT_SKIP_PROSPECT})
), page AS (
    SELECT
        *,
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
        ) AS prospect_messaged_person
    FROM
        cached
{selection}
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

            {_verification_required_to_view(
                'searcher_verification_level_id',
                'privacy_verification_level_id')} AS verification_required_to_view
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


Q_CACHED_SEARCH = _cached_search("""
    ORDER BY
        position
""")

Q_CACHED_SIMILAR_PROFILES = _cached_search("""
    WHERE
        prospect_person_id != %(prospect_person_id)s
    ORDER BY
        personality <#> (
            SELECT personality FROM person WHERE id = %(prospect_person_id)s
        )
    LIMIT
        %(n)s
""")

Q_QUIZ_SEARCH = _cached_search("""
    ORDER BY
        -- If this is changed, other subqueries will need changing too
        CASE
            WHEN
                (SELECT count_answers > 0 FROM searcher)
            AND
                (
                    SELECT
                        count(*) >= 250
                    FROM
                        cached
                    WHERE
                        profile_photo_uuid IS NOT NULL
                    AND
                        verified
                )
            THEN
                profile_photo_uuid IS NOT NULL AND verified
            ELSE
                profile_photo_uuid IS NOT NULL
        END DESC,

        match_percentage DESC
    LIMIT
        %(n)s
""")
