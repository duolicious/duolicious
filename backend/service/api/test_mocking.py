import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import jwt

from service.api import mocking
from service.api.auth import social
from service.api.chat import online

_GOOGLE_AUD = 'test-google-aud'
_APPLE_AUD = 'test-apple-aud'
_NONCE = 'test-nonce'
_NON_DEV_ENVS = ['prod', 'staging']


def _token_with_a_garbage_signature(iss: str, aud: str) -> str:
    return jwt.encode(
        {
            'iss': iss,
            'aud': aud,
            'sub': 'test-sub',
            'email': 'test@example.com',
            'nonce': _NONCE,
            'iat': int(time.time()),
            'exp': int(time.time()) + 600,
        },
        'a key that is not the provider signing key',
        algorithm='HS256',
    )


class _AllSentinelsOn(unittest.TestCase):
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
            ('max_online_subscriptions_file', 'max-online-subscriptions'),
        ]:
            p = patch.object(mocking, attr, input_dir / name)
            p.start()
            self.addCleanup(p.stop)

    def _set_env(self, env: str) -> None:
        p = patch.object(mocking, 'ENV', env)
        p.start()
        self.addCleanup(p.stop)
        for cached in [
            mocking._enable_mocking,
            mocking._warn_that_mocking_is_on,
            online._max_online_subscriptions,
        ]:
            cached.cache_clear()
            self.addCleanup(cached.cache_clear)


class TestOverridesFollowTheGate(_AllSentinelsOn):
    def test_overrides_apply_in_dev(self) -> None:
        self._set_env('dev')

        with self.assertLogs(mocking.logger, 'WARNING'):
            self.assertTrue(mocking.enable_mocking())
        self.assertTrue(mocking.disable_ip_rate_limit())
        self.assertTrue(mocking.disable_account_rate_limit())
        self.assertEqual(mocking.mock_ip_address(), '203.0.113.7')
        self.assertEqual(online.max_online_subscriptions(), 3)

    def test_overrides_are_inert_outside_dev(self) -> None:
        for env in _NON_DEV_ENVS:
            with self.subTest(env=env):
                self._set_env(env)

                with self.assertNoLogs(mocking.logger, 'WARNING'):
                    self.assertFalse(mocking.enable_mocking())
                self.assertFalse(mocking.disable_ip_rate_limit())
                self.assertFalse(mocking.disable_account_rate_limit())
                self.assertIsNone(mocking.mock_ip_address())
                self.assertEqual(
                    online.max_online_subscriptions(),
                    online.MAX_ONLINE_SUBSCRIPTIONS)


class TestSignInFollowsTheGate(_AllSentinelsOn):
    """Sign-in tokens whose signature no provider made. The real verifiers
    are stubbed to reject them, as they would, so the tests need no
    network."""

    def setUp(self) -> None:
        super().setUp()

        self.enterContext(
            patch.object(social, '_GOOGLE_CLIENT_IDS', [_GOOGLE_AUD]))
        self.enterContext(
            patch.object(social, '_APPLE_CLIENT_IDS', [_APPLE_AUD]))
        self.enterContext(patch.object(
            social._google_id_token,
            'verify_oauth2_token',
            side_effect=ValueError('bad signature')))
        self.enterContext(patch.object(
            social._apple_jwks_client,
            'get_signing_key_from_jwt',
            side_effect=jwt.exceptions.PyJWKClientError('no matching key')))

        self.google_token = _token_with_a_garbage_signature(
            social._GOOGLE_ISSUERS[0], _GOOGLE_AUD)
        self.apple_token = _token_with_a_garbage_signature(
            social._APPLE_ISSUER, _APPLE_AUD)

    def test_signature_is_skipped_in_dev(self) -> None:
        self._set_env('dev')

        google = social.verify_google_id_token(self.google_token)
        apple = social.verify_apple_identity_token(
            self.apple_token, expected_nonce=_NONCE)

        self.assertEqual(google.sub, 'test-sub')
        self.assertEqual(apple.sub, 'test-sub')

    def test_signature_is_checked_outside_dev(self) -> None:
        for env in _NON_DEV_ENVS:
            with self.subTest(env=env):
                self._set_env(env)

                with self.assertRaises(social.SocialAuthError):
                    social.verify_google_id_token(self.google_token)
                with self.assertRaises(social.SocialAuthError):
                    social.verify_apple_identity_token(
                        self.apple_token, expected_nonce=_NONCE)


if __name__ == '__main__':
    unittest.main()
