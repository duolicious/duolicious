import re
import unittest

from search.sql import Q_UNCACHED_SEARCH_2
from service.api.chat.messagestorage.inbox import (
    Q_INBOX_SNAPSHOT,
    _composed_body,
)

# The searcher's filter predicates that the inbox snapshot deliberately
# doesn't mirror in `matches_search_filters` (the rationale for each is with
# the query in `__init__`).
DELIBERATELY_UNMIRRORED = frozenset([
    'search_preference_club',
    'search_preference_messaged',
    'search_preference_skipped',
])


def search_preference_tables(query: str) -> frozenset[str]:
    return frozenset(re.findall(r'\bsearch_preference_\w+', query))


class TestMatchesSearchFiltersMirrorsSearch(unittest.TestCase):
    def test_inbox_snapshot_mirrors_search_filter_predicates(self) -> None:
        """
        `matches_search_filters` in the inbox snapshot query mirrors the
        searcher's filter predicates in `Q_UNCACHED_SEARCH_2` by hand. This
        drift alarm can't check the predicates themselves, but it does fail
        when a search filter's preference table is consulted by one query and
        not the other -- the way a new filter would otherwise silently never
        flag intros. On a genuinely one-sided filter, extend
        DELIBERATELY_UNMIRRORED and document why beside the inbox query.
        """
        search_tables = search_preference_tables(Q_UNCACHED_SEARCH_2)
        inbox_tables = search_preference_tables(Q_INBOX_SNAPSHOT)

        self.assertEqual(
            inbox_tables,
            search_tables - DELIBERATELY_UNMIRRORED,
        )

        # If a deliberately-unmirrored table disappears from the search query,
        # its entry above is stale.
        self.assertLessEqual(DELIBERATELY_UNMIRRORED, search_tables)


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
