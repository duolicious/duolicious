import unittest

from service.api.search.sql.test_search import maximal_prefs
from service.api.chat.messagestorage.inbox import build_inbox_snapshot_query


class TestBuildInboxSnapshotQuery(unittest.TestCase):
    def test_every_filter_parameter_is_bound(self) -> None:
        prefs = maximal_prefs()

        query, params = build_inbox_snapshot_query(
            username='11111111-1111-1111-1111-111111111111',
            prefs=prefs,
            prospect_username=None,
        )

        for param in params:
            self.assertIn(f'%({param})s', query)

    def test_two_way_distance_alongside_own_distance_filter(self) -> None:
        prefs = maximal_prefs()
        self.assertIsNotNone(prefs['distance_meters'])
        self.assertTrue(prefs['two_way_furthest_distance'])

        _, params = build_inbox_snapshot_query(
            username='11111111-1111-1111-1111-111111111111',
            prefs=prefs,
            prospect_username=None,
        )

        self.assertEqual(
            params['searcher_coordinates'],
            prefs['searcher_coordinates'],
        )

    def test_entry_predicate_binds_the_prospect(self) -> None:
        query, params = build_inbox_snapshot_query(
            username='11111111-1111-1111-1111-111111111111',
            prefs=maximal_prefs(),
            prospect_username='22222222-2222-2222-2222-222222222222',
        )

        self.assertIn('remote_bare_jid = %(remote_bare_jid)s', query)
        self.assertEqual(
            params['remote_bare_jid'],
            '22222222-2222-2222-2222-222222222222@duolicious.app',
        )


if __name__ == '__main__':
    unittest.main()
