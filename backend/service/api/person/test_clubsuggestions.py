import unittest

import numpy as np

from service.api.person.clubsuggestions import club_groups, slot_quotas, take_turns


class TestClubGroups(unittest.TestCase):
    def test_close_clubs_share_a_group_and_distant_ones_stay_apart(self) -> None:
        embeddings = np.array([
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.95, 0.1, 0.0],
            [0.1, 0.95, 0.0],
            [0.0, 0.0, 1.0],
        ])

        groups = club_groups(embeddings)

        self.assertCountEqual(
            [sorted(g) for g in groups],
            [[0, 2], [1, 3], [4]])

    def test_groups_list_their_most_central_club_first(self) -> None:
        embeddings = np.array([
            [1.0, 0.3, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, -0.3, 0.0],
        ])

        self.assertEqual(club_groups(embeddings)[0][0], 1)

    def test_one_club_is_one_group(self) -> None:
        self.assertEqual(club_groups(np.array([[1.0, 2.0]])), [[0]])


class TestSlotQuotas(unittest.TestCase):
    def test_slots_follow_group_size(self) -> None:
        self.assertEqual(slot_quotas([21, 2, 1], 10), [9, 1, 0])
        self.assertEqual(slot_quotas([5, 5], 10), [5, 5])
        self.assertEqual(slot_quotas([1], 10), [10])

    def test_more_groups_than_slots_gives_the_first_groups_one_each(self) -> None:
        self.assertEqual(slot_quotas([3, 2] + [1] * 10, 10), [1] * 10 + [0] * 2)


class TestTakeTurns(unittest.TestCase):
    def test_clubs_alternate_and_skip_what_is_taken(self) -> None:
        taken = {'b1'}

        picks = take_turns([['a1', 'a2', 'a3'], ['b1', 'a1', 'b2']], 4, taken)

        self.assertEqual(picks, ['a1', 'b2', 'a2', 'a3'])
        self.assertEqual(taken, {'a1', 'a2', 'a3', 'b1', 'b2'})

    def test_stops_when_every_list_runs_out(self) -> None:
        self.assertEqual(take_turns([['a'], ['a']], 5, set()), ['a'])


if __name__ == '__main__':
    unittest.main()
