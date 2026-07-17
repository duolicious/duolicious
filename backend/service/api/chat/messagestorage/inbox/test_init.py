import unittest

from database import Row
from search.sql.search import (
    _HIDE_ME,
    _PROSPECT_DIDNT_SKIP_SEARCHER,
    _REVERSE_GENDER_EXISTS,
    _SEARCHER_DIDNT_MESSAGE_PROSPECT,
    _SEARCHER_DIDNT_SKIP_PROSPECT,
    _VERIFICATION_SATISFIED,
    build_uncached_search,
    search_only_clauses,
)
from searchfilters import ENUM_FILTERS, and_clauses, prospect_filters
from service.api.chat.messagestorage.inbox import _composed_body

# The depth `build_uncached_search` lays its `WHERE` out at. A clause is stored
# without indentation and indented into place, so this is what it takes to look
# one up in the finished query.
_SEARCH_WHERE_DEPTH = 8

# Every predicate the search applies that `matches_search_filters` deliberately
# doesn't (the rationale for each is with the inbox query in `__init__`). The
# tests below pin this to be exactly what `search_only_clauses` produces, in
# both directions: a filter added to the search alone fails, and so does an
# entry here that the search no longer applies.
SEARCH_ONLY = frozenset([
    # A viewer is never their own intro's sender, and an intro from the
    # moderation bot isn't the kind of mismatch the flag is for.
    'prospect.id != %(searcher_person_id)s',
    "'bot' <> ALL(prospect.roles)",
    'prospect.activated',
    'prospect.shadow_banned_at IS NULL',
    # An intro's sender chose to message the viewer, so neither their own
    # gender preference nor their hiding from strangers is a mismatch.
    _REVERSE_GENDER_EXISTS,
    _HIDE_ME,
    # The inbox `location` rules already handle skipped/messaged.
    _PROSPECT_DIDNT_SKIP_SEARCHER,
    _SEARCHER_DIDNT_SKIP_PROSPECT,
    _SEARCHER_DIDNT_MESSAGE_PROSPECT,
    # A platform requirement, not a viewer-chosen filter.
    _VERIFICATION_SATISFIED,
])


def maximal_prefs() -> Row:
    """Preferences where every optional filter is active, so none is omitted."""
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
        searcher_gender_id=1,
        searcher_count_answers=1,
    )
    return prefs


class TestMatchesSearchFiltersMirrorsSearch(unittest.TestCase):
    def test_search_applies_every_shared_filter(self) -> None:
        """
        The inbox builds `matches_search_filters` from
        `searchfilters.prospect_filters`, so it applies exactly those
        predicates. This fails if the search stops applying one of them -- at
        which point the inbox would be flagging intros against a filter the
        search no longer honours.
        """
        prefs = maximal_prefs()
        search_sql, _ = build_uncached_search(1, 10, 0, prefs)

        for clause in prospect_filters(prefs).clauses:
            self.assertIn(and_clauses([clause], _SEARCH_WHERE_DEPTH), search_sql)

    def test_search_only_predicates_are_declared(self) -> None:
        """
        A new filter on a prospect's own attributes belongs in
        `searchfilters.prospect_filters`, so that the search and the inbox both
        get it. This fails when one is added to the search alone; if it
        genuinely can't apply to an intro, it goes in `search_only_clauses`,
        and then here with a note saying why.
        """
        self.assertEqual(
            frozenset(search_only_clauses(maximal_prefs())),
            SEARCH_ONLY,
        )

    def test_search_only_predicates_are_not_shared_ones(self) -> None:
        """
        The two sets are disjoint by construction, so a clause appearing in
        both would mean the search applies it twice.
        """
        prefs = maximal_prefs()

        self.assertFalse(
            frozenset(search_only_clauses(prefs))
            & frozenset(prospect_filters(prefs).clauses),
        )


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
