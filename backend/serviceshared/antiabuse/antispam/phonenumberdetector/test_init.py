import unittest
from serviceshared.antiabuse.antispam.phonenumberdetector import detect_phone_numbers


class TestDetectPhoneNumbers(unittest.TestCase):

    def test_detect_phone_numbers(self) -> None:
        sample_text = """
            I'm 21 years old
            I was born on 1999
            I was born on December 12 1999
            I was born on 2001-12-01
            There's about 8 billion people in the world right now
            call me on (02) 9070 0718
            My number is 9070 0718
            But also, without the spaces: 90700718
            But also, without the spaces: 290700718
            call me on 0414903060
            call me on +61414903060
            Contact me at +1-555-123-4567 or (555) 765-4321 for more info.
            There's over 9000 ways to do this

            Here are some other phone numbers you might encounter:
            1. U.S. example: (123) 456-7890
            2. International format: +1-123-456-7890
            3. U.K. example: +44 20 7946 0958
            4. German example: +49 30 12345678
            5. Indian example: +91 98765 43210
            6. Simple format: 123-456-7890
            7. No area code: 456-7890
            8. Short number: +1 123 4567
            9. Non-phone number: Call us at the usual place, thanks!
            10. Random characters: +123-abc-defghij
            11. Misformatted: (123)456--7890
            12. Too long: +1-123-456-78901234
            13. Australian example: +61 2 9876 5432
            14. No country code but valid: 987-654-3210
            15. Swiss example: +41 22 123 45 67

            My Zangi:1020084361
        """

        detected = set(detect_phone_numbers(sample_text))
        expected = set([
            '(02) 9070 0718',
            '9070 0718',
            '90700718',
            '290700718',
            '0414903060',
            '+61414903060',
            '+1-555-123-4567',
            '(555) 765-4321',
            '(123) 456-7890',
            '+1-123-456-7890',
            '+44 20 7946 0958',
            '+49 30 12345678',
            '+91 98765 43210',
            '123-456-7890',
            '456-7890',
            '+61 2 9876 5432',
            '987-654-3210',
            '+41 22 123 45 67',
            '1020084361',
        ])

        false_negatives = expected - detected

        false_positives = detected - expected

        self.assertSetEqual(false_negatives, set())

        self.assertSetEqual(false_positives, set())

