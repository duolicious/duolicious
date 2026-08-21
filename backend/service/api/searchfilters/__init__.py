from collections.abc import Sequence
from dataclasses import dataclass
from textwrap import dedent, indent
from typing import NamedTuple, TypeAlias

from serviceshared.constants import LAST_ONLINE_NOW_SECONDS
from serviceshared.database import (
    Row,
    row_bool,
    row_int,
    row_int_list,
    row_int_list_or_none,
    row_int_or_none,
    row_str,
)

SearchParam: TypeAlias = int | str | list[int] | None


def sql_fragment(text: str) -> str:
    return dedent(text).strip()


class EnumFilter(NamedTuple):
    param: str
    column: str
    lookup: str


ENUM_FILTERS = [
    EnumFilter('gender_ids',              'gender_id',              'gender'),
    EnumFilter('orientation_ids',         'orientation_id',         'orientation'),
    EnumFilter('ethnicity_ids',           'ethnicity_id',           'ethnicity'),
    EnumFilter('has_profile_picture_ids', 'has_profile_picture_id', 'yes_no'),
    EnumFilter('looking_for_ids',         'looking_for_id',         'looking_for'),
    EnumFilter('smoking_ids',             'smoking_id',             'yes_no_optional'),
    EnumFilter('drinking_ids',            'drinking_id',            'frequency'),
    EnumFilter('drugs_ids',               'drugs_id',               'yes_no_optional'),
    EnumFilter('long_distance_ids',       'long_distance_id',       'yes_no_optional'),
    EnumFilter('relationship_status_ids', 'relationship_status_id', 'relationship_status'),
    EnumFilter('has_kids_ids',            'has_kids_id',            'yes_no_optional'),
    EnumFilter('wants_kids_ids',          'wants_kids_id',          'yes_no_maybe'),
    EnumFilter('exercise_ids',            'exercise_id',            'frequency'),
    EnumFilter('religion_ids',            'religion_id',            'religion'),
    EnumFilter('star_sign_ids',           'star_sign_id',           'star_sign'),
]


class BoundFilter(NamedTuple):
    param: str
    source: str
    clause: str
    omit_when_zero: bool = False


BOUND_FILTERS = [
    BoundFilter(
        param='max_last_online_seconds',
        source=sql_fragment("""
            SELECT seconds
            FROM last_online
            WHERE id = sp.last_online_id
        """),
        clause=sql_fragment("""
            prospect.last_online_time >
                now() - %(max_last_online_seconds)s * interval '1 second'
        """),
    ),
    BoundFilter(
        param='min_age',
        source=sql_fragment("""
            SELECT sp.min_age
        """),
        clause=sql_fragment("""
            prospect.date_of_birth <= (
                CURRENT_DATE - INTERVAL '1 year' * %(min_age)s
            )::DATE
        """),
        omit_when_zero=True,
    ),
    BoundFilter(
        param='max_age',
        source=sql_fragment("""
            SELECT sp.max_age
        """),
        clause=sql_fragment("""
            prospect.date_of_birth > (
                CURRENT_DATE - INTERVAL '1 year' * (%(max_age)s + 1)
            )::DATE
        """),
    ),
    BoundFilter(
        param='min_height_cm',
        source=sql_fragment("""
            SELECT sp.min_height_cm
        """),
        clause=sql_fragment("""
            COALESCE(prospect.height_cm, 0) >= %(min_height_cm)s
        """),
    ),
    BoundFilter(
        param='max_height_cm',
        source=sql_fragment("""
            SELECT sp.max_height_cm
        """),
        clause=sql_fragment("""
            COALESCE(prospect.height_cm, 999) <= %(max_height_cm)s
        """),
    ),
]


_ST_DWITHIN = sql_fragment("""
    ST_DWithin(
        prospect.coordinates,
        %(searcher_coordinates)s::GEOGRAPHY,
        %(distance_meters)s
    )
""")


_SHOWS_ONLINE_STATUS = sql_fragment("""
    prospect.show_my_online_status
""")


# The prospect answered none of the searcher's Q&A filters contrarily. The
# subquery is deliberately uncorrelated: the planner builds the exclusion set
# once per statement and hashes every prospect against it, where a correlated
# form re-probes `answer` per prospect and made broad searches time out. In
# per-prospect consumers (inbox) the hashed subplan is likewise built once per
# statement and reused across rows.
_ANSWER_NOT_CONTRARY = sql_fragment("""
    prospect.id NOT IN (
        SELECT
            ans.person_id
        FROM
            search_preference_answer AS pref
        JOIN
            answer AS ans
        ON
            ans.question_id = pref.question_id
        WHERE
            pref.person_id = %(searcher_person_id)s AND
            ans.answer IS NOT NULL AND
            ans.answer != pref.answer
    )
""")


# The prospect answered this Q&A filter whose accept_unanswered is FALSE. One
# clause per required question rather than a single aggregated set: a GROUP
# BY/HAVING subquery gets un-nested into a semi-join against an unindexed
# aggregate, which the planner nested-loops under row misestimates (>60s on
# prod data), whereas plain membership in `answer` keeps its indexes usable by
# every join strategy.
def _answer_required_clause(param: str) -> str:
    return sql_fragment(f"""
        prospect.id IN (
            SELECT
                person_id
            FROM
                answer
            WHERE
                question_id = %({param})s AND
                answer IS NOT NULL
        )
    """)


_PARAM_ENUM_SELECTS = ',\n'.join(
    f"""    CASE
        WHEN cardinality(sp.{enum.param}) = (SELECT count(*) FROM {enum.lookup})
        THEN NULL
        ELSE sp.{enum.param}
    END AS {enum.param}"""
    for enum in ENUM_FILTERS
)

_PARAM_BOUND_SELECTS = ',\n'.join(
    f"    (\n{indent(bound.source, ' ' * 8)}\n    ) AS {bound.param}"
    for bound in BOUND_FILTERS
)


_ENUM_FILTER_BY_COLUMN = {enum.column: enum for enum in ENUM_FILTERS}

# Two-way filter key -> the person.<column> the prospect's own preference is
# checked against. When a key's two-way flag is on, the searcher only sees
# prospects whose own preference for that attribute accepts the searcher.
_TWO_WAY_ENUM_COLUMNS = {
    'gender':                'gender_id',
    'orientation':           'orientation_id',
    'ethnicity':             'ethnicity_id',
    'has_a_profile_picture': 'has_profile_picture_id',
    'looking_for':           'looking_for_id',
    'smoking':               'smoking_id',
    'drinking':              'drinking_id',
    'drugs':                 'drugs_id',
    'long_distance':         'long_distance_id',
    'relationship_status':   'relationship_status_id',
    'has_kids':              'has_kids_id',
    'wants_kids':            'wants_kids_id',
    'exercise':              'exercise_id',
    'religion':              'religion_id',
    'star_sign':             'star_sign_id',
}

# Every two-way filter key, ordered to match the Search Filters screen. Only
# `gender` is two-way by default.
TWO_WAY_FILTER_KEYS = [
    'gender',
    'age',
    'furthest_distance',
    'orientation',
    'relationship_status',
    'looking_for',
    'wants_kids',
    'has_kids',
    'has_a_profile_picture',
    'drugs',
    'long_distance',
    'ethnicity',
    'smoking',
    'religion',
    'drinking',
    'height',
    'exercise',
    'star_sign',
]

_SEARCHER_ATTR_SELECTS = ',\n'.join(
    f'    person.{column} AS searcher_{column}'
    for column in _TWO_WAY_ENUM_COLUMNS.values()
)

_TWO_WAY_FLAG_SELECTS = ',\n'.join(
    f'    sp.two_way_{key}'
    for key in TWO_WAY_FILTER_KEYS
)


def _q_search_parameters(person_predicate: str) -> str:
    return f"""
SELECT
    person.id AS searcher_person_id,
{_PARAM_ENUM_SELECTS},
{_PARAM_BOUND_SELECTS},
    1000 * sp.distance AS distance_meters,
    sp.club_name AS club_preference,
    sp.show_messaged,
    sp.show_skipped,
    EXISTS (
        SELECT 1
        FROM search_preference_answer
        WHERE person_id = person.id
    ) AS has_answer_prefs,
    ARRAY(
        SELECT question_id
        FROM search_preference_answer
        WHERE person_id = person.id
        AND accept_unanswered = FALSE
        ORDER BY question_id
    ) AS required_answer_question_ids,
    person.coordinates::TEXT AS searcher_coordinates,
    person.personality::TEXT AS searcher_personality,
    EXTRACT(YEAR FROM AGE(person.date_of_birth))::INT AS searcher_age,
    person.height_cm AS searcher_height_cm,
{_SEARCHER_ATTR_SELECTS},
{_TWO_WAY_FLAG_SELECTS},
    person.count_answers AS searcher_count_answers
FROM
    person
JOIN
    search_preference AS sp
ON
    sp.person_id = person.id
WHERE
    {person_predicate}
"""


Q_SEARCH_PARAMETERS = _q_search_parameters(
    'person.id = %(searcher_person_id)s')

Q_SEARCH_PARAMETERS_BY_UUID = _q_search_parameters(
    'person.uuid = %(username)s::uuid')


def and_clauses(clauses: Sequence[str]) -> str:
    if not clauses:
        return 'TRUE'

    return '\nAND\n'.join(f'({clause})' for clause in clauses)


@dataclass(frozen=True)
class ProspectFilters:
    clauses: list[str]
    params: dict[str, SearchParam]


def prospect_filters(prefs: Row) -> ProspectFilters:
    params: dict[str, SearchParam] = {}
    clauses: list[str] = []

    distance_meters = row_int_or_none(prefs, 'distance_meters')
    if distance_meters is not None:
        params['distance_meters'] = distance_meters
        params['searcher_coordinates'] = row_str(prefs, 'searcher_coordinates')
        clauses.append(_ST_DWITHIN)

    for bound in BOUND_FILTERS:
        value = row_int_or_none(prefs, bound.param)
        if value is None or (value == 0 and bound.omit_when_zero):
            continue
        params[bound.param] = value
        clauses.append(bound.clause)

    max_last_online = row_int_or_none(prefs, 'max_last_online_seconds')
    if max_last_online is not None and max_last_online <= LAST_ONLINE_NOW_SECONDS:
        clauses.append(_SHOWS_ONLINE_STATUS)

    for enum in ENUM_FILTERS:
        ids = row_int_list_or_none(prefs, enum.param)
        if ids is None:
            continue
        params[enum.param] = ids
        clauses.append(f"prospect.{enum.column} = ANY(%({enum.param})s::SMALLINT[])")

    if row_bool(prefs, 'has_answer_prefs'):
        params['searcher_person_id'] = row_int(prefs, 'searcher_person_id')
        clauses.append(_ANSWER_NOT_CONTRARY)

    for i, question_id in enumerate(
            row_int_list(prefs, 'required_answer_question_ids')):
        param = f'required_answer_question_id_{i}'
        params[param] = question_id
        clauses.append(_answer_required_clause(param))

    return ProspectFilters(clauses=clauses, params=params)


_REVERSE_AGE = sql_fragment("""
    (
        COALESCE(reverse_preference.min_age, 0) <= %(searcher_age)s
    AND
        COALESCE(reverse_preference.max_age, 999) >= %(searcher_age)s
    )
""")


_REVERSE_DISTANCE = sql_fragment("""
    ST_DWithin(
        prospect.coordinates,
        %(searcher_coordinates)s::GEOGRAPHY,
        COALESCE(1000.0 * reverse_preference.distance, 1e9)
    )
""")


_REVERSE_HEIGHT = sql_fragment("""
    (
        COALESCE(%(searcher_height_cm)s, 0) >=
            COALESCE(reverse_preference.min_height_cm, 0)
    AND
        COALESCE(%(searcher_height_cm)s, 999) <=
            COALESCE(reverse_preference.max_height_cm, 999)
    )
""")


def two_way_filters(prefs: Row) -> ProspectFilters:
    checks: list[str] = []
    params: dict[str, SearchParam] = {}

    for key in TWO_WAY_FILTER_KEYS:
        if not row_bool(prefs, f'two_way_{key}'):
            continue

        column = _TWO_WAY_ENUM_COLUMNS.get(key)
        if column is not None:
            param = _ENUM_FILTER_BY_COLUMN[column].param
            checks.append(
                f'%(searcher_{column})s = ANY(reverse_preference.{param})')
            params[f'searcher_{column}'] = row_int(prefs, f'searcher_{column}')
        elif key == 'age':
            checks.append(_REVERSE_AGE)
            params['searcher_age'] = row_int(prefs, 'searcher_age')
        elif key == 'furthest_distance':
            checks.append(_REVERSE_DISTANCE)
            params['searcher_coordinates'] = row_str(prefs, 'searcher_coordinates')
        elif key == 'height':
            checks.append(_REVERSE_HEIGHT)
            params['searcher_height_cm'] = row_int_or_none(prefs, 'searcher_height_cm')

    if not checks:
        return ProspectFilters(clauses=[], params={})

    conditions = '\nAND\n'.join(indent(check, ' ' * 8).lstrip() for check in checks)
    clause = sql_fragment(f"""
        EXISTS (
            SELECT 1
            FROM search_preference AS reverse_preference
            WHERE
                reverse_preference.person_id = prospect.id
            AND
                {conditions}
        )
    """)

    return ProspectFilters(clauses=[clause], params=params)
