"""
A searcher's search preferences, and the predicates they imply about a
prospect.

Shared by the `/search` endpoint and the inbox's `matches_search_filters`
(`service.api.chat.messagestorage.inbox`), which flags intros from senders
outside the viewer's filters. Both build their predicates from
`prospect_filters`, which is what keeps them from drifting apart; the search
adds further predicates of its own.
"""

from dataclasses import dataclass
from typing import NamedTuple, TypeAlias

from database import (
    Row,
    row_int_list_or_none,
    row_int_or_none,
)

# A bound value for an assembled search: scalar filters, id-array filters, or
# absent (None).
SearchParam: TypeAlias = int | str | list[int] | None


class EnumFilter(NamedTuple):
    param: str   # bound parameter, and the `Q_SEARCH_PARAMETERS` column
    table: str   # the `search_preference_*` table
    column: str  # id column, named the same on the preference and the prospect
    lookup: str  # every option, for deciding whether the searcher picked them all


# A preference returns its selected id array, or NULL when the searcher selected
# every option -- the signal to leave that filter out of the query, which the
# planner can't work out for itself. Every person is seeded a full set of
# preferences at signup, so each row exists.
ENUM_FILTERS = [
    EnumFilter('gender_ids',              'search_preference_gender',              'gender_id',              'gender'),
    EnumFilter('orientation_ids',         'search_preference_orientation',         'orientation_id',         'orientation'),
    EnumFilter('ethnicity_ids',           'search_preference_ethnicity',           'ethnicity_id',           'ethnicity'),
    EnumFilter('has_profile_picture_ids', 'search_preference_has_profile_picture', 'has_profile_picture_id', 'yes_no'),
    EnumFilter('looking_for_ids',         'search_preference_looking_for',         'looking_for_id',         'looking_for'),
    EnumFilter('smoking_ids',             'search_preference_smoking',             'smoking_id',             'yes_no_optional'),
    EnumFilter('drinking_ids',            'search_preference_drinking',            'drinking_id',            'frequency'),
    EnumFilter('drugs_ids',               'search_preference_drugs',               'drugs_id',               'yes_no_optional'),
    EnumFilter('long_distance_ids',       'search_preference_long_distance',       'long_distance_id',       'yes_no_optional'),
    EnumFilter('relationship_status_ids', 'search_preference_relationship_status', 'relationship_status_id', 'relationship_status'),
    EnumFilter('has_kids_ids',            'search_preference_has_kids',            'has_kids_id',            'yes_no_optional'),
    EnumFilter('wants_kids_ids',          'search_preference_wants_kids',          'wants_kids_id',          'yes_no_maybe'),
    EnumFilter('exercise_ids',            'search_preference_exercise',            'exercise_id',            'frequency'),
    EnumFilter('religion_ids',            'search_preference_religion',            'religion_id',            'religion'),
    EnumFilter('star_sign_ids',           'search_preference_star_sign',           'star_sign_id',           'star_sign'),
]


class BoundFilter(NamedTuple):
    param: str
    clause: str
    # A `min_age` or minimum height of zero admits every prospect, so it
    # contributes no clause. A `max_age` of zero doesn't.
    omit_when_zero: bool = False


BOUND_FILTERS = [
    BoundFilter(
        'min_age',
        "prospect.date_of_birth <= (\n"
        "            CURRENT_DATE - INTERVAL '1 year' * %(min_age)s\n"
        "        )::DATE",
        omit_when_zero=True,
    ),
    BoundFilter(
        'max_age',
        "prospect.date_of_birth > (\n"
        "            CURRENT_DATE - INTERVAL '1 year' * (%(max_age)s + 1)\n"
        "        )::DATE",
    ),
    BoundFilter(
        'min_height_cm',
        "COALESCE(prospect.height_cm, 0) >= %(min_height_cm)s",
    ),
    BoundFilter(
        'max_height_cm',
        "COALESCE(prospect.height_cm, 999) <= %(max_height_cm)s",
    ),
]


_PARAM_ENUM_SELECTS = ',\n'.join(
    f"""    (
        SELECT CASE
            WHEN count(*) = (SELECT count(*) FROM {lookup})
            THEN NULL
            ELSE COALESCE(array_agg({col}), ARRAY[]::SMALLINT[])
        END
        FROM {table}
        WHERE person_id = person.id
    ) AS {name}"""
    for name, table, col, lookup in ENUM_FILTERS
)

def _q_search_parameters(person_predicate: str) -> str:
    return f"""
SELECT
    person.id AS searcher_person_id,
{_PARAM_ENUM_SELECTS},
    (
        SELECT 1000 * distance
        FROM search_preference_distance
        WHERE person_id = person.id
    ) AS distance_meters,
    (
        SELECT club_name
        FROM search_preference_club
        WHERE person_id = person.id
    ) AS club_preference,
    (
        SELECT min_age
        FROM search_preference_age
        WHERE person_id = person.id
    ) AS min_age,
    (
        SELECT max_age
        FROM search_preference_age
        WHERE person_id = person.id
    ) AS max_age,
    (
        SELECT min_height_cm
        FROM search_preference_height_cm
        WHERE person_id = person.id
    ) AS min_height_cm,
    (
        SELECT max_height_cm
        FROM search_preference_height_cm
        WHERE person_id = person.id
    ) AS max_height_cm,
    (
        SELECT last_online.seconds
        FROM search_preference_last_online
        JOIN last_online
        ON last_online.id = search_preference_last_online.last_online_id
        WHERE search_preference_last_online.person_id = person.id
    ) AS max_last_online_seconds,
    (
        SELECT yes_no.name = 'Yes'
        FROM search_preference_messaged
        JOIN yes_no
        ON yes_no.id = search_preference_messaged.messaged_id
        WHERE search_preference_messaged.person_id = person.id
    ) AS show_messaged,
    (
        SELECT yes_no.name = 'Yes'
        FROM search_preference_skipped
        JOIN yes_no
        ON yes_no.id = search_preference_skipped.skipped_id
        WHERE search_preference_skipped.person_id = person.id
    ) AS show_skipped,
    EXISTS (
        SELECT 1
        FROM search_preference_answer
        WHERE person_id = person.id
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
    {person_predicate}
"""


# Keyed by id for the search, and by uuid for the inbox, whose caller has
# only the viewer's username.
Q_SEARCH_PARAMETERS = _q_search_parameters(
    'person.id = %(searcher_person_id)s')

Q_SEARCH_PARAMETERS_BY_UUID = _q_search_parameters(
    'person.uuid = %(username)s::uuid')


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


@dataclass(frozen=True)
class ProspectFilters:
    """The predicates to apply, and the values they bind."""
    clauses: list[str]
    params: dict[str, SearchParam]


def prospect_filters(prefs: Row) -> ProspectFilters:
    """
    The predicates constraining a prospect's own attributes to the preferences
    in `prefs` (one `Q_SEARCH_PARAMETERS` row). A preference that admits every
    prospect yields no clause at all, because the planner can't eliminate an
    always-true predicate itself.

    These are exactly the filters the inbox applies; the search adds its own on
    top (see `search.sql.search.build_uncached_search`).
    """
    params: dict[str, SearchParam] = dict(
        max_last_online_seconds=prefs['max_last_online_seconds'],
    )

    clauses = [
        "prospect.last_online_time >\n"
        "            now() - %(max_last_online_seconds)s * interval '1 second'",
    ]

    distance_meters = row_int_or_none(prefs, 'distance_meters')
    if distance_meters is not None:
        params['distance_meters'] = distance_meters
        params['searcher_coordinates'] = prefs['searcher_coordinates']
        clauses.append(
            "ST_DWithin(\n"
            "            prospect.coordinates,\n"
            "            %(searcher_coordinates)s::GEOGRAPHY,\n"
            "            %(distance_meters)s\n"
            "        )"
        )

    for bound in BOUND_FILTERS:
        value = row_int_or_none(prefs, bound.param)
        if value is None or (value == 0 and bound.omit_when_zero):
            continue
        params[bound.param] = value
        clauses.append(bound.clause)

    for enum in ENUM_FILTERS:
        ids = row_int_list_or_none(prefs, enum.param)
        if ids is None:
            continue
        params[enum.param] = ids
        clauses.append(f"prospect.{enum.column} = ANY(%({enum.param})s::SMALLINT[])")

    if prefs['has_answer_prefs']:
        params['searcher_person_id'] = prefs['searcher_person_id']
        clauses.append(_ANSWER_NOT_EXISTS)

    return ProspectFilters(clauses=clauses, params=params)
