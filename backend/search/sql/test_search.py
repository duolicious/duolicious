import unittest

from database import Row
from search.sql.search import (
    _HIDE_ME,
    _PROSPECT_DIDNT_SKIP_SEARCHER,
    _SEARCHER_DIDNT_MESSAGE_PROSPECT,
    _SEARCHER_DIDNT_SKIP_PROSPECT,
    _VERIFICATION_SATISFIED,
    Q_INSERT_SEARCH_CACHE,
    build_uncached_search,
    search_cache_insert_params,
    search_only_clauses,
)
from searchfilters import (
    ENUM_FILTERS,
    TWO_WAY_FILTER_KEYS,
    prospect_filters,
    two_way_filters,
)

SEARCH_ONLY = frozenset([
    'prospect.id != %(searcher_person_id)s',
    "'bot' <> ALL(prospect.roles)",
    'prospect.activated',
    'prospect.shadow_banned_at IS NULL',
    _HIDE_ME,
    _PROSPECT_DIDNT_SKIP_SEARCHER,
    _SEARCHER_DIDNT_SKIP_PROSPECT,
    _SEARCHER_DIDNT_MESSAGE_PROSPECT,
    _VERIFICATION_SATISFIED,
])

_SEARCHER_ID_COLUMNS = [
    'gender_id', 'orientation_id', 'ethnicity_id', 'has_profile_picture_id',
    'looking_for_id', 'smoking_id', 'drinking_id', 'drugs_id',
    'long_distance_id', 'relationship_status_id', 'has_kids_id',
    'wants_kids_id', 'exercise_id', 'religion_id', 'star_sign_id',
]


def maximal_prefs() -> Row:
    prefs: Row = {enum.param: [1] for enum in ENUM_FILTERS}
    prefs.update(
        distance_meters=1,
        club_preference=None,
        min_age=18,
        max_age=99,
        min_height_cm=1,
        max_height_cm=1,
        max_last_online_seconds=1,
        show_messaged=False,
        show_skipped=False,
        has_answer_prefs=True,
        searcher_person_id=1,
        searcher_coordinates='POINT(0 0)',
        searcher_personality='[0]',
        searcher_age=25,
        searcher_height_cm=170,
        searcher_count_answers=1,
    )
    for column in _SEARCHER_ID_COLUMNS:
        prefs[f'searcher_{column}'] = 1
    for key in TWO_WAY_FILTER_KEYS:
        prefs[f'two_way_{key}'] = True
    return prefs


class TestMatchesSearchFiltersMirrorsSearch(unittest.TestCase):
    def test_search_applies_every_shared_filter(self) -> None:
        prefs = maximal_prefs()
        search_sql, _ = build_uncached_search(1, 10, 0, prefs)

        for clause in prospect_filters(prefs).clauses:
            self.assertIn(clause, search_sql)

    def test_search_applies_every_two_way_filter(self) -> None:
        prefs = maximal_prefs()
        search_sql, _ = build_uncached_search(1, 10, 0, prefs)

        reverse = two_way_filters(prefs)
        self.assertEqual(len(reverse.clauses), len(TWO_WAY_FILTER_KEYS))
        for clause in reverse.clauses:
            self.assertIn(clause, search_sql)

    def test_search_only_predicates_are_declared(self) -> None:
        self.assertEqual(
            frozenset(search_only_clauses(maximal_prefs())),
            SEARCH_ONLY,
        )

    def test_search_only_predicates_are_not_shared_ones(self) -> None:
        prefs = maximal_prefs()

        self.assertFalse(
            frozenset(search_only_clauses(prefs))
            & frozenset(prospect_filters(prefs).clauses),
        )


class TestUncachedSearchStreams(unittest.TestCase):
    def test_uncached_search_is_read_only(self) -> None:
        search_sql, _ = build_uncached_search(1, 10, 0, maximal_prefs())

        self.assertNotIn('INSERT', search_sql.upper())
        self.assertNotIn('search_cache', search_sql)

    def test_uncached_search_has_no_pipeline_breakers(self) -> None:
        search_sql, _ = build_uncached_search(1, 10, 0, maximal_prefs())

        self.assertNotIn('ROW_NUMBER', search_sql.upper())
        self.assertNotIn('COUNT(', search_sql.upper())


class TestSearchCacheInsert(unittest.TestCase):
    def test_insert_params_match_query_placeholders(self) -> None:
        for name in search_cache_insert_params([]):
            self.assertIn(f'%({name})s', Q_INSERT_SEARCH_CACHE)

    def test_insert_params_map_candidate_rows_to_columns(self) -> None:
        candidate: Row = dict(
            prospect_person_id=5,
            prospect_uuid='b1b8bdbb-c67f-42d1-a5eb-77b0c9871ac9',
            profile_photo_uuid=None,
            name='Kim',
            age=None,
            match_percentage=99.5,
            personality='[1,0]',
            verified=True,
        )

        self.assertEqual(
            search_cache_insert_params([candidate]),
            dict(
                prospect_person_ids=[5],
                prospect_uuids=['b1b8bdbb-c67f-42d1-a5eb-77b0c9871ac9'],
                profile_photo_uuids=[None],
                names=['Kim'],
                ages=[None],
                match_percentages=[99.5],
                personalities=['[1,0]'],
                verifieds=[True],
            ),
        )


if __name__ == '__main__':
    unittest.main()
