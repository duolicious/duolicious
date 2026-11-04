import unittest
from datetime import date

from service.api.person import accepts_email_only_links


class TestAcceptsEmailOnlyLinks(unittest.TestCase):
    def test_accepts_the_day_before_the_cutoff(self) -> None:
        self.assertTrue(accepts_email_only_links(date(2026, 12, 14)))

    def test_accepts_the_cutoff_day(self) -> None:
        self.assertTrue(accepts_email_only_links(date(2026, 12, 15)))

    def test_rejects_the_day_after_the_cutoff(self) -> None:
        self.assertFalse(accepts_email_only_links(date(2026, 12, 16)))


if __name__ == '__main__':
    unittest.main()
