import unittest

from database import Row
from search import (
    PERSONALITY_INDEX_PREFIX,
    _plan_uses_personality_index,
    _trim_candidates,
)
from search.sql import MAX_SEARCH_CANDIDATES


def candidate(i: int, match_percentage: float) -> Row:
    return dict(prospect_person_id=i, match_percentage=match_percentage)


class TestTrimCandidates(unittest.TestCase):
    def test_keeps_small_sets_in_arrival_order(self) -> None:
        candidates = [candidate(i, float(i)) for i in range(3)]

        self.assertEqual(_trim_candidates(candidates), candidates)

    def test_keeps_the_best_matches_when_over_the_cap(self) -> None:
        candidates = [candidate(i, float(i % 1000)) for i in range(2000)]

        trimmed = _trim_candidates(candidates)

        self.assertEqual(len(trimmed), MAX_SEARCH_CANDIDATES)
        self.assertEqual(
            min(c['match_percentage'] for c in trimmed),
            625.0,
        )


class TestPlanUsesPersonalityIndex(unittest.TestCase):
    def test_finds_the_index_in_a_nested_plan(self) -> None:
        plan = [{'Plan': {
            'Node Type': 'Limit',
            'Plans': [{
                'Node Type': 'Index Scan',
                'Index Name': PERSONALITY_INDEX_PREFIX,
            }],
        }}]

        self.assertTrue(_plan_uses_personality_index(plan))

    def test_rejects_a_plan_with_other_indexes(self) -> None:
        plan = [{'Plan': {
            'Node Type': 'Sort',
            'Plans': [{
                'Node Type': 'Index Scan',
                'Index Name': 'person_pkey',
            }],
        }}]

        self.assertFalse(_plan_uses_personality_index(plan))


if __name__ == '__main__':
    unittest.main()
