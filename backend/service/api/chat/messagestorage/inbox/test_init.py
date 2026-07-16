import re
import unittest

from search.sql import build_uncached_search, prospect_filter_clauses
from search.sql.search import _ENUM_FILTERS
from service.api.chat.messagestorage.inbox import _composed_body
from database import Row

# `search_preference_*` tables the search reads for predicates of its own,
# which `matches_search_filters` deliberately doesn't apply (the rationale for
# each is with the inbox query in `__init__`).
SEARCH_ONLY = frozenset([
    'search_preference_club',
    'search_preference_messaged',
    'search_preference_skipped',
    # The reverse-gender check: an intro's sender chose to message the viewer,
    # so their own gender preference isn't a mismatch.
    'search_preference_gender',
])


def search_preference_tables(query: str) -> frozenset[str]:
    return frozenset(re.findall(r'\bsearch_preference_\w+', query))


def maximal_prefs() -> Row:
    """Preferences where every optional filter is active, so none is omitted."""
    prefs: Row = {name: [1] for name, *_ in _ENUM_FILTERS}
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
        searcher_gender_id=1,
        searcher_count_answers=1,
    )
    return prefs


class TestMatchesSearchFiltersMirrorsSearch(unittest.TestCase):
    def test_search_applies_every_shared_filter(self) -> None:
        """
        The inbox builds `matches_search_filters` from
        `prospect_filter_clauses`, so it applies exactly those predicates. This
        fails if the search stops applying one of them -- at which point the
        inbox would be flagging intros against a filter the search no longer
        honours.
        """
        prefs = maximal_prefs()
        search_sql, _ = build_uncached_search(1, 10, 0, prefs)

        for clause in prospect_filter_clauses(prefs, {}):
            self.assertIn(clause, search_sql)

    def test_search_only_predicates_are_declared(self) -> None:
        """
        A new filter on a prospect's own attributes belongs in
        `prospect_filter_clauses`, so that the search and the inbox both get
        it. This fails when one is added to the search alone; if it genuinely
        can't apply to an intro, name it in SEARCH_ONLY and say why beside the
        inbox query.
        """
        prefs = maximal_prefs()
        search_sql, _ = build_uncached_search(1, 10, 0, prefs)
        shared_sql = ' '.join(prospect_filter_clauses(prefs, {}))

        search_only = (
            search_preference_tables(search_sql)
            - search_preference_tables(shared_sql)
        )

        self.assertEqual(search_only, SEARCH_ONLY & search_only)


class TestComposedBody(unittest.TestCase):
    def test_no_reaction_returns_last_message(self) -> None:
        self.assertEqual(
            _composed_body('hey, how are you?', None, None),
            'hey, how are you?',
        )

    def test_reaction_decorates_its_target(self) -> None:
        self.assertEqual(
            _composed_body('a newer message', '👍', 'hey, how are you?'),
            'Reacted 👍 to: hey, how are you?',
        )

    def test_multiline_target(self) -> None:
        self.assertEqual(
            _composed_body('x', '😂', 'line one\nline two'),
            'Reacted 😂 to: line one\nline two',
        )


if __name__ == '__main__':
    unittest.main()
