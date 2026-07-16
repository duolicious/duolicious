"""
SQL for the `/search` endpoint: search-preference upserts, the uncached
search that (re)builds `search_cache`, and the cached/quiz reads of it.
"""

from typing import TypeAlias

from database import (
    Row,
    row_bool,
    row_int,
    row_int_list_or_none,
    row_int_or_none,
    row_str,
    row_str_or_none,
)

# A bound value for the assembled search: scalar filters, id-array filters, or
# absent (None).
SearchParam: TypeAlias = int | str | list[int] | None



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



# The searcher's own person-row attributes and every search preference,
# resolved in one round-trip so the search below can be built from constants.
# Each enum preference returns its selected id array, or NULL when the searcher
# selected every option -- the signal for `build_uncached_search` to omit that
# filter's clause entirely (the planner can't do that elimination itself).
# Every person is seeded a full set of preferences at signup, so each scalar
# row exists.
_ENUM_FILTERS = [
    # (param name, preference table, id column, lookup table)
    ('orientation_ids',         'search_preference_orientation',        'orientation_id',         'orientation'),
    ('ethnicity_ids',           'search_preference_ethnicity',          'ethnicity_id',           'ethnicity'),
    ('has_profile_picture_ids', 'search_preference_has_profile_picture','has_profile_picture_id', 'yes_no'),
    ('looking_for_ids',         'search_preference_looking_for',        'looking_for_id',         'looking_for'),
    ('smoking_ids',             'search_preference_smoking',            'smoking_id',             'yes_no_optional'),
    ('drinking_ids',            'search_preference_drinking',           'drinking_id',            'frequency'),
    ('drugs_ids',               'search_preference_drugs',              'drugs_id',               'yes_no_optional'),
    ('long_distance_ids',       'search_preference_long_distance',      'long_distance_id',       'yes_no_optional'),
    ('relationship_status_ids', 'search_preference_relationship_status','relationship_status_id', 'relationship_status'),
    ('has_kids_ids',            'search_preference_has_kids',           'has_kids_id',            'yes_no_optional'),
    ('wants_kids_ids',          'search_preference_wants_kids',         'wants_kids_id',          'yes_no_maybe'),
    ('exercise_ids',            'search_preference_exercise',           'exercise_id',            'frequency'),
    ('religion_ids',            'search_preference_religion',           'religion_id',            'religion'),
    ('star_sign_ids',           'search_preference_star_sign',          'star_sign_id',           'star_sign'),
]

# Prospect column each enum filter constrains (equal to the preference id column).
_ENUM_PROSPECT_COLUMN = {name: col for name, _, col, _ in _ENUM_FILTERS}

_PARAM_ENUM_SELECTS = ',\n'.join(
    f"""    (
        SELECT CASE
            WHEN count(*) = (SELECT count(*) FROM {lookup})
            THEN NULL
            ELSE COALESCE(array_agg({col}), ARRAY[]::SMALLINT[])
        END
        FROM {table}
        WHERE person_id = %(searcher_person_id)s
    ) AS {name}"""
    for name, table, col, lookup in _ENUM_FILTERS
)

Q_SEARCH_PARAMETERS = f"""
SELECT
{_PARAM_ENUM_SELECTS},
    (
        SELECT 1000 * distance
        FROM search_preference_distance
        WHERE person_id = %(searcher_person_id)s
    ) AS distance_meters,
    (
        SELECT club_name
        FROM search_preference_club
        WHERE person_id = %(searcher_person_id)s
    ) AS club_preference,
    (
        SELECT min_age
        FROM search_preference_age
        WHERE person_id = %(searcher_person_id)s
    ) AS min_age,
    (
        SELECT max_age
        FROM search_preference_age
        WHERE person_id = %(searcher_person_id)s
    ) AS max_age,
    (
        SELECT min_height_cm
        FROM search_preference_height_cm
        WHERE person_id = %(searcher_person_id)s
    ) AS min_height_cm,
    (
        SELECT max_height_cm
        FROM search_preference_height_cm
        WHERE person_id = %(searcher_person_id)s
    ) AS max_height_cm,
    (
        SELECT last_online.seconds
        FROM search_preference_last_online
        JOIN last_online
        ON last_online.id = search_preference_last_online.last_online_id
        WHERE search_preference_last_online.person_id = %(searcher_person_id)s
    ) AS max_last_online_seconds,
    (
        SELECT yes_no.name = 'Yes'
        FROM search_preference_messaged
        JOIN yes_no
        ON yes_no.id = search_preference_messaged.messaged_id
        WHERE search_preference_messaged.person_id = %(searcher_person_id)s
    ) AS show_messaged,
    (
        SELECT yes_no.name = 'Yes'
        FROM search_preference_skipped
        JOIN yes_no
        ON yes_no.id = search_preference_skipped.skipped_id
        WHERE search_preference_skipped.person_id = %(searcher_person_id)s
    ) AS show_skipped,
    EXISTS (
        SELECT 1
        FROM search_preference_answer
        WHERE person_id = %(searcher_person_id)s
    ) AS has_answer_prefs,
    -- The searcher's own attributes. Passed back into the search as bound
    -- parameters so that `personality` is a plan-time constant, which is what
    -- lets the ORDER BY index-scan `idx__person__personality`; read from a
    -- joined CTE instead, pgvector cannot use the index at all.
    person.coordinates::TEXT AS searcher_coordinates,
    person.personality::TEXT AS searcher_personality,
    person.gender_id AS searcher_gender_id,
    person.count_answers AS searcher_count_answers
FROM
    person
WHERE
    person.id = %(searcher_person_id)s
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

_ANSWER_NOT_EXISTS = """NOT EXISTS (
            SELECT 1
            FROM (
                SELECT *
                FROM search_preference_answer
                WHERE person_id = %(searcher_person_id)s
            ) AS pref
            LEFT JOIN
                answer ans
            ON
                ans.person_id = prospect.id AND
                ans.question_id = pref.question_id
            WHERE
                -- Contrary because the answer exists and is wrong
                ans.answer IS NOT NULL AND
                ans.answer != pref.answer
            OR
                -- Contrary because the answer doesn't exist but should
                ans.answer IS NULL AND
                pref.accept_unanswered = FALSE
        )"""

_ALWAYS_HIDE_ME = """-- The prospect wants to be shown to strangers or isn't a stranger
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

_ALWAYS_DIDNT_SKIP_SEARCHER = """-- The prospect did not skip the searcher
        prospect.id NOT IN (
            SELECT
                subject_person_id
            FROM
                skipped
            WHERE
                object_person_id = %(searcher_person_id)s
        )"""

_ALWAYS_VERIFY = """-- Exclude users who should be verified but aren't
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


# The searcher's filter predicates (except club membership) are mirrored (by
# hand) by the `matches_search_filters` column of the inbox snapshot query in
# `service.api.chat.messagestorage.inbox`, which flags intros from senders
# outside the viewer's search filters. If a filter is added or changed here or
# in `Q_SEARCH_PARAMETERS`, change it there too. (A unit test beside the inbox
# query fails when a `search_preference_*` table is consulted by the search and
# not the inbox.)
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
    gender_preference: list[int],
    prefs: Row,
) -> tuple[str, dict[str, SearchParam]]:
    """
    Assemble the uncached search and its bound parameters from `prefs` (one
    `Q_SEARCH_PARAMETERS` row). Filters whose preference matches every prospect
    -- all enum options selected, no distance/age/height bound, "show
    messaged/skipped", no answer preferences -- are omitted entirely rather
    than run as always-true predicates.
    """
    params: dict[str, SearchParam] = dict(
        searcher_person_id=searcher_person_id,
        n=n,
        o=o,
        gender_preference=gender_preference,
        max_last_online_seconds=row_int(prefs, 'max_last_online_seconds'),
        searcher_coordinates=row_str(prefs, 'searcher_coordinates'),
        searcher_personality=row_str(prefs, 'searcher_personality'),
        searcher_gender_id=row_int(prefs, 'searcher_gender_id'),
        searcher_count_answers=row_int(prefs, 'searcher_count_answers'),
    )

    club_preference = row_str_or_none(prefs, 'club_preference')
    distance_meters = row_int_or_none(prefs, 'distance_meters')
    if club_preference is not None:
        params['club_preference'] = club_preference

    clauses = [
        "prospect.activated",
        "prospect.shadow_banned_at IS NULL",
        "prospect.last_online_time >\n"
        "            now() - %(max_last_online_seconds)s * interval '1 second'",
        "prospect.gender_id = ANY(%(gender_preference)s::SMALLINT[])",
    ]

    if distance_meters is not None:
        params['distance_meters'] = distance_meters
        clauses.append(
            "ST_DWithin(\n"
            "            prospect.coordinates,\n"
            "            %(searcher_coordinates)s::GEOGRAPHY,\n"
            "            %(distance_meters)s\n"
            "        )"
        )

    # The searcher meets the prospect's gender preference. When searching a
    # club this is not required (the shared club is the connection), so the
    # whole clause drops out.
    if club_preference is None:
        clauses.append(_REVERSE_GENDER_EXISTS)

    min_age = row_int_or_none(prefs, 'min_age')
    max_age = row_int_or_none(prefs, 'max_age')
    if min_age:
        params['min_age'] = min_age
        clauses.append(
            "prospect.date_of_birth <= (\n"
            "            CURRENT_DATE - INTERVAL \'1 year\' * %(min_age)s\n"
            "        )::DATE"
        )
    if max_age is not None:
        params['max_age'] = max_age
        clauses.append(
            "prospect.date_of_birth > (\n"
            "            CURRENT_DATE - INTERVAL \'1 year\' * (%(max_age)s + 1)\n"
            "        )::DATE"
        )

    for name, _table, _col, _lookup in _ENUM_FILTERS:
        ids = row_int_list_or_none(prefs, name)
        if ids is None:
            continue
        params[name] = ids
        column = _ENUM_PROSPECT_COLUMN[name]
        clauses.append(f"prospect.{column} = ANY(%({name})s::SMALLINT[])")

    min_height_cm = row_int_or_none(prefs, 'min_height_cm')
    max_height_cm = row_int_or_none(prefs, 'max_height_cm')
    if min_height_cm is not None:
        params['min_height_cm'] = min_height_cm
        clauses.append(
            "COALESCE(prospect.height_cm, 0) >= %(min_height_cm)s")
    if max_height_cm is not None:
        params['max_height_cm'] = max_height_cm
        clauses.append(
            "COALESCE(prospect.height_cm, 999) <= %(max_height_cm)s")

    clauses.append(_ALWAYS_HIDE_ME)
    clauses.append(_ALWAYS_DIDNT_SKIP_SEARCHER)

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

    if row_bool(prefs, 'has_answer_prefs'):
        clauses.append(_ANSWER_NOT_EXISTS)

    clauses.append(_ALWAYS_VERIFY)

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

