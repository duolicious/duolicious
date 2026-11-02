import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from service.api import mocking
from service.api.chat import online


class TestMockingAllowed(unittest.TestCase):
    def test_needs_dev_and_the_sentinel(self) -> None:
        self.assertTrue(mocking._mocking_allowed('dev', True))
        self.assertFalse(mocking._mocking_allowed('prod', True))
        self.assertFalse(mocking._mocking_allowed('dev', False))
        self.assertFalse(mocking._mocking_allowed('prod', False))


class TestOverridesFollowTheGate(unittest.TestCase):
    """Every override is on in the sentinel files, so the only thing that
    varies between cases is `DUO_ENV`."""

    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        input_dir = Path(tmp.name)

        for name, content in [
            ('enable-mocking', '1'),
            ('disable-ip-rate-limit', '1'),
            ('disable-account-rate-limit', '1'),
            ('mock-ip-address', '203.0.113.7'),
            ('max-online-subscriptions', '3'),
        ]:
            (input_dir / name).write_text(content)

        for attr, name in [
            ('enable_mocking_file', 'enable-mocking'),
            ('disable_ip_rate_limit_file', 'disable-ip-rate-limit'),
            ('disable_account_rate_limit_file', 'disable-account-rate-limit'),
            ('mock_ip_address_file', 'mock-ip-address'),
        ]:
            p = patch.object(mocking, attr, input_dir / name)
            p.start()
            self.addCleanup(p.stop)

        p = patch.object(online, '_TEST_INPUT_DIR', input_dir)
        p.start()
        self.addCleanup(p.stop)

    def _set_env(self, env: str) -> None:
        p = patch.object(mocking, 'ENV', env)
        p.start()
        self.addCleanup(p.stop)
        mocking._enable_mocking.cache_clear()
        online._max_online_subscriptions.cache_clear()
        self.addCleanup(mocking._enable_mocking.cache_clear)
        self.addCleanup(online._max_online_subscriptions.cache_clear)

    def test_overrides_apply_in_dev(self) -> None:
        self._set_env('dev')

        self.assertTrue(mocking.enable_mocking())
        self.assertTrue(mocking.disable_ip_rate_limit())
        self.assertTrue(mocking.disable_account_rate_limit())
        self.assertEqual(mocking.mock_ip_address(), '203.0.113.7')
        self.assertEqual(online.max_online_subscriptions(), 3)

    def test_overrides_are_inert_outside_dev(self) -> None:
        self._set_env('prod')

        self.assertFalse(mocking.enable_mocking())
        self.assertFalse(mocking.disable_ip_rate_limit())
        self.assertFalse(mocking.disable_account_rate_limit())
        self.assertIsNone(mocking.mock_ip_address())
        self.assertEqual(
            online.max_online_subscriptions(),
            online.MAX_ONLINE_SUBSCRIPTIONS)


if __name__ == '__main__':
    unittest.main()
