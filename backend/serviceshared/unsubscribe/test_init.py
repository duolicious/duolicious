import unittest
from urllib.parse import parse_qs, urlparse

from serviceshared.unsubscribe import (
    person_token,
    person_uuid_from_token,
    unsubscribe_url,
)

PERSON_UUID = '3fa85f64-5717-4562-b3fc-2c963f66afa6'


def token_of(url: str) -> str:
    return parse_qs(urlparse(url).query)['token'][0]


class TestUnsubscribeToken(unittest.TestCase):
    def test_round_trip(self) -> None:
        token = token_of(unsubscribe_url(PERSON_UUID))
        self.assertEqual(person_uuid_from_token(token), PERSON_UUID)

    def test_token_round_trip(self) -> None:
        token = person_token(PERSON_UUID)
        self.assertEqual(person_uuid_from_token(token), PERSON_UUID)

    def test_rejects_other_person(self) -> None:
        signature = token_of(unsubscribe_url(PERSON_UUID)).partition('.')[2]
        other_uuid = '00000000-0000-0000-0000-000000000000'
        self.assertIsNone(person_uuid_from_token(f'{other_uuid}.{signature}'))

    def test_rejects_malformed(self) -> None:
        for token in ['', PERSON_UUID, f'{PERSON_UUID}.', f'{PERSON_UUID}.é']:
            self.assertIsNone(person_uuid_from_token(token))


if __name__ == '__main__':
    unittest.main()
