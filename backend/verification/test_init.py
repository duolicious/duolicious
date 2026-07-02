import asyncio
import unittest
from verification import (
    Failure,
    Success,
    VerificationResult,
    get_messages,
    process_response,
    get_system_content,
)


def require_success(processed: VerificationResult) -> Success:
    if processed.success is None:
        raise AssertionError('Expected verification success')
    return processed.success


def require_failure(processed: VerificationResult) -> Failure:
    if processed.failure is None:
        raise AssertionError('Expected verification failure')
    return processed.failure

estimated_age = 42

success_content_template = """
{
  "image_1_was_not_edited": 1.0,
  "image_1_is_photograph": 1.0,
  "image_1_is_not_screenshot": 1.0,
  "image_1_has_at_least_one_person": 1.0,
  "image_1_has_exactly_one_person": 1.0,
  "image_1_has_claimed_gender": 1.0,
  "image_1_has_claimed_age": 1.0,
  "image_1_has_claimed_minimum_age": 1.0,
  "image_1_has_claimed_ethnicity": 1.0,
  "image_1_has_smiling_person": 1.0,
  "image_1_has_eyebrow_touch": 1.0,
  "image_1_has_downward_thumb": 1.0,
  "image_1_has_person_from_image_2": 1.0,
  "image_1_has_person_from_image_3": 1.0
}
"""

success_content_1 = success_content_template

success_content_2 = success_content_template.replace(
    '"image_1_has_claimed_ethnicity": 1.0',
    '"image_1_has_claimed_ethnicity": null')

success_content_3 = success_content_template.replace(
    '"image_1_has_person_from_image_2": 1.0',
    '"image_1_has_person_from_image_2": 0.0').replace(
    '"image_1_has_person_from_image_3": 1.0',
    '"image_1_has_person_from_image_3": 0.0')

failure_content_1 = success_content_template.replace(
    '"image_1_is_photograph": 1.0',
    '"image_1_is_photograph": 0.0')

failure_content_2 = success_content_template.replace(
    '"image_1_was_not_edited": 1.0',
    '"image_1_was_not_edited": 0.0')

failure_content_3 = success_content_template.replace(
    '"image_1_is_not_screenshot": 1.0',
    '"image_1_is_not_screenshot": 0.0')

failure_content_4 = success_content_template.replace(
    '"image_1_has_at_least_one_person": 1.0',
    '"image_1_has_at_least_one_person": 0.0')

failure_content_5 = success_content_template.replace(
    '"image_1_has_exactly_one_person": 1.0',
    '"image_1_has_exactly_one_person": 0.0')

failure_content_6 = success_content_template.replace(
    '"image_1_has_claimed_gender": 1.0',
    '"image_1_has_claimed_gender": 0.0')

failure_content_7 = success_content_template.replace(
    '"image_1_has_claimed_age": 1.0',
    '"image_1_has_claimed_age": 0.0')

failure_content_8 = success_content_template.replace(
    '"image_1_has_claimed_ethnicity": 1.0',
    '"image_1_has_claimed_ethnicity": 0.0')

failure_content_9 = success_content_template.replace(
    '"image_1_has_smiling_person": 1.0',
    '"image_1_has_smiling_person": 0.0')

failure_content_10 = success_content_template.replace(
    '"image_1_has_eyebrow_touch": 1.0',
    '"image_1_has_eyebrow_touch": 0.0')

failure_content_11 = success_content_template.replace(
    '"image_1_has_downward_thumb": 1.0',
    '"image_1_has_downward_thumb": 0.0')

failure_content_12 = success_content_template.replace(
    '"image_1_has_person_from_image_2": 1.0',
    '"image_1_has_person_from_image_2": 0.0')

class TestProcessResponse(unittest.TestCase):
    def test_success_1(self) -> None:
        response = success_content_1

        processed = process_response(response, claimed_uuids=['u2', 'u3'])

        self.assertIsNone(processed.failure)
        self.assertIsNotNone(processed.success)

        self.assertTrue(require_success(processed).is_verified_age)
        self.assertTrue(require_success(processed).is_verified_gender)
        self.assertTrue(require_success(processed).is_verified_ethnicity)

        self.assertEqual(require_success(processed).verified_uuids, ['u2', 'u3'])
        self.assertEqual(require_success(processed).raw_json, response)

    def test_success_2(self) -> None:
        response = success_content_2

        processed = process_response(response, claimed_uuids=['u2', 'u3'])

        self.assertIsNone(processed.failure)
        self.assertIsNotNone(processed.success)

        self.assertTrue(require_success(processed).is_verified_age)
        self.assertTrue(require_success(processed).is_verified_gender)
        self.assertFalse(require_success(processed).is_verified_ethnicity)

        self.assertEqual(require_success(processed).verified_uuids, ['u2', 'u3'])
        self.assertEqual(require_success(processed).raw_json, response)

    def test_success_3(self) -> None:
        response = success_content_3

        processed = process_response(response, claimed_uuids=['u2', 'u3'])

        self.assertIsNone(processed.failure)
        self.assertIsNotNone(processed.success)

        self.assertTrue(require_success(processed).is_verified_age)
        self.assertTrue(require_success(processed).is_verified_gender)
        self.assertTrue(require_success(processed).is_verified_ethnicity)

        self.assertEqual(require_success(processed).verified_uuids, [])
        self.assertEqual(require_success(processed).raw_json, response)

    def test_failure_1(self) -> None:
        response = failure_content_1

        processed = process_response(response, claimed_uuids=['u2', 'u3'])

        self.assertIsNotNone(processed.failure)
        self.assertIsNone(processed.success)

        self.assertEqual(require_failure(processed).reason,
            "Our AI thinks your image isn’t a real photo.")
        self.assertEqual(require_failure(processed).raw_json, response)

    def test_failure_2(self) -> None:
        response = failure_content_2

        processed = process_response(response, claimed_uuids=['u2', 'u3'])

        self.assertIsNotNone(processed.failure)
        self.assertIsNone(processed.success)

        self.assertEqual(require_failure(processed).reason,
            "Our AI thinks your image might have been edited.")
        self.assertEqual(require_failure(processed).raw_json, response)

    def test_failure_4(self) -> None:
        response = failure_content_4

        processed = process_response(response, claimed_uuids=['u2', 'u3'])

        self.assertIsNotNone(processed.failure)
        self.assertIsNone(processed.success)

        self.assertEqual(require_failure(processed).reason,
            "Our AI thinks your photo doesn’t have a person in it.")
        self.assertEqual(require_failure(processed).raw_json, response)

    def test_failure_5(self) -> None:
        response = failure_content_5

        processed = process_response(response, claimed_uuids=['u2', 'u3'])

        self.assertIsNotNone(processed.failure)
        self.assertIsNone(processed.success)

        self.assertEqual(require_failure(processed).reason,
            "Our AI thinks there’s more than one person in your photo.")
        self.assertEqual(require_failure(processed).raw_json, response)

    def test_failure_6(self) -> None:
        response = failure_content_6

        processed = process_response(response, claimed_uuids=['u2', 'u3'])

        self.assertIsNotNone(processed.failure)
        self.assertIsNone(processed.success)

        self.assertEqual(require_failure(processed).reason,
            "Our AI couldn’t verify your gender.")
        self.assertEqual(require_failure(processed).raw_json, response)

    def test_failure_7(self) -> None:
        response = failure_content_7

        processed = process_response(response, claimed_uuids=['u2', 'u3'])

        self.assertIsNotNone(processed.failure)
        self.assertIsNone(processed.success)

        self.assertEqual(require_failure(processed).reason,
            "Our AI couldn’t verify your age.")
        self.assertEqual(require_failure(processed).raw_json, response)

    def test_failure_8(self) -> None:
        response = failure_content_8

        processed = process_response(response, claimed_uuids=['u2', 'u3'])

        self.assertIsNotNone(processed.failure)
        self.assertIsNone(processed.success)

        self.assertEqual(require_failure(processed).reason,
            "Our AI couldn’t verify your ethnicity.")
        self.assertEqual(require_failure(processed).raw_json, response)

    def test_failure_9(self) -> None:
        response = failure_content_9

        processed = process_response(response, claimed_uuids=['u2', 'u3'])

        self.assertIsNotNone(processed.failure)
        self.assertIsNone(processed.success)

        self.assertEqual(require_failure(processed).reason,
            "Our AI thinks you’re not smiling.")
        self.assertEqual(require_failure(processed).raw_json, response)

    def test_failure_10(self) -> None:
        response = failure_content_10

        processed = process_response(response, claimed_uuids=['u2', 'u3'])

        self.assertIsNotNone(processed.failure)
        self.assertIsNone(processed.success)

        self.assertEqual(require_failure(processed).reason,
            "Our AI thinks you’re not touching your eyebrow.")
        self.assertEqual(require_failure(processed).raw_json, response)

    def test_failure_11(self) -> None:
        response = failure_content_11

        processed = process_response(response, claimed_uuids=['u2', 'u3'])

        self.assertIsNotNone(processed.failure)
        self.assertIsNone(processed.success)

        self.assertEqual(require_failure(processed).reason,
            "Our AI thinks you’re not giving the thumbs down.")
        self.assertEqual(require_failure(processed).raw_json, response)


class TestGetMessages(unittest.TestCase):
    def test_get_messages_null_ethnicity(self) -> None:
        self.maxDiff = 99999

        messages = asyncio.run(get_messages(
            proof_uuid='u1',
            claimed_uuids=[],
            claimed_age=26,
            claimed_gender='Man',
            claimed_ethnicity=None,
        ))

        self.assertEqual(
            messages,
            [
                {
                    "role": "system",
                    "content": """
You have been given one or more image(s) by a user attempting to verify their identity on a social media website. The user provides Image #1 as proof of their identity. The user makes some claims about the image(s). Provide a JSON object in the following format which assigns a probability from 0.0 to 1.0 to each claim being true:

```typescript
{
  // Image #1 was not edited
  image_1_was_not_edited: number

  // Image #1 is a photograph
  image_1_is_photograph: number

  // Image #1 shows no signs of being a screenshot or photograph of a computer screen
  image_1_is_not_screenshot: number

  // Image #1 contains at least one person
  image_1_has_at_least_one_person: number

  // Image #1 contains exactly one person
  image_1_has_exactly_one_person: number

  // Image #1 contains a person whose gender is: Man.
  // When checking this claim, note that the user chose this gender from these options: Man, Woman, Agender, Femboy, Intersex, Non-binary, Transgender, Trans woman, Trans man, and Other.
  // In equivocal cases, prefer probabilities near 1.0.
  image_1_has_claimed_gender: number

  // Image #1 contains a person whose age is: 26
  image_1_has_claimed_age: number

  // Image #1 contains a person whose age is 18 or older
  image_1_has_claimed_minimum_age: number

  // Image #1 contains a person who is smiling
  image_1_has_smiling_person: number

  // Image #1 contains a person whose hand is in contact with their eyebrow or a part of their face adjacent to their eyebrow (e.g. their forehead)
  image_1_has_eyebrow_touch: number

  // Image #1 contains a person whose thumb is visible
  image_1_has_thumb: number

  // Image #1 contains a person whose thumb is pointed downward
  image_1_has_downward_thumb: number

}
```
""".strip()
                },
                {
                    "role": "user",
                    "content": [
                        {
                          "type": "text",
                          "text": "Image #1:",
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": 'https://user-images.duolicious.app/450-u1.jpg',
                                "detail": "high"
                            }
                        },
                    ]
                },
            ]
        )

    def test_get_messages(self) -> None:
        self.maxDiff = 99999

        messages = asyncio.run(get_messages(
            proof_uuid='u1',
            claimed_uuids=['u2', 'u3'],
            claimed_age=26,
            claimed_gender='Man',
            claimed_ethnicity='White/Caucasian',
        ))

        self.assertEqual(
            messages,
            [
                {
                    "role": "system",
                    "content": """
You have been given one or more image(s) by a user attempting to verify their identity on a social media website. The user provides Image #1 as proof of their identity. The user makes some claims about the image(s). Provide a JSON object in the following format which assigns a probability from 0.0 to 1.0 to each claim being true:

```typescript
{
  // Image #1 was not edited
  image_1_was_not_edited: number

  // Image #1 is a photograph
  image_1_is_photograph: number

  // Image #1 shows no signs of being a screenshot or photograph of a computer screen
  image_1_is_not_screenshot: number

  // Image #1 contains at least one person
  image_1_has_at_least_one_person: number

  // Image #1 contains exactly one person
  image_1_has_exactly_one_person: number

  // Image #1 contains a person whose gender is: Man.
  // When checking this claim, note that the user chose this gender from these options: Man, Woman, Agender, Femboy, Intersex, Non-binary, Transgender, Trans woman, Trans man, and Other.
  // In equivocal cases, prefer probabilities near 1.0.
  image_1_has_claimed_gender: number

  // Image #1 contains a person whose age is: 26
  image_1_has_claimed_age: number

  // Image #1 contains a person whose age is 18 or older
  image_1_has_claimed_minimum_age: number

  // Image #1 contains a person whose primary or only ethnicity is: White/Caucasian.
  // When checking this claim, note the user chose this ethnicity from these options: Black/African Descent, East Asian, Hispanic/Latino, Middle Eastern, Native American, Pacific Islander, South Asian, Southeast Asian, White/Caucasian, and Other.
  // In equivocal cases, prefer probabilities near 1.0.
  image_1_has_claimed_ethnicity: number

  // Image #1 contains a person who is smiling
  image_1_has_smiling_person: number

  // Image #1 contains a person whose hand is in contact with their eyebrow or a part of their face adjacent to their eyebrow (e.g. their forehead)
  image_1_has_eyebrow_touch: number

  // Image #1 contains a person whose thumb is visible
  image_1_has_thumb: number

  // Image #1 contains a person whose thumb is pointed downward
  image_1_has_downward_thumb: number

  // Image #1 contains a person who is in Image #2
  image_1_has_person_from_image_2: number

  // Image #1 contains a person who is in Image #3
  image_1_has_person_from_image_3: number

}
```
""".strip()
                },
                {
                    "role": "user",
                    "content": [
                        {
                          "type": "text",
                          "text": "Image #1:",
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": 'https://user-images.duolicious.app/450-u1.jpg',
                                "detail": "high"
                            }
                        },
                        {
                          "type": "text",
                          "text": "Image #2:",
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f'https://user-images.duolicious.app/450-u2.jpg',
                                "detail": "low"
                            }
                        },
                        {
                          "type": "text",
                          "text": "Image #3:",
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": 'https://user-images.duolicious.app/450-u3.jpg',
                                "detail": "low"
                            }
                        },
                    ]
                },
            ]
        )

class TestGetSystemContent(unittest.TestCase):
    def test_get_system_content_with_ethnicity(self) -> None:
        self.maxDiff = 99999

        system_content = get_system_content(
            num_claimed_uuids=3,
            claimed_age=26,
            claimed_gender='Woman',
            claimed_ethnicity='Black',
        )

        self.assertEqual(
            system_content,
            """
You have been given one or more image(s) by a user attempting to verify their identity on a social media website. The user provides Image #1 as proof of their identity. The user makes some claims about the image(s). Provide a JSON object in the following format which assigns a probability from 0.0 to 1.0 to each claim being true:

```typescript
{
  // Image #1 was not edited
  image_1_was_not_edited: number

  // Image #1 is a photograph
  image_1_is_photograph: number

  // Image #1 shows no signs of being a screenshot or photograph of a computer screen
  image_1_is_not_screenshot: number

  // Image #1 contains at least one person
  image_1_has_at_least_one_person: number

  // Image #1 contains exactly one person
  image_1_has_exactly_one_person: number

  // Image #1 contains a person whose gender is: Woman.
  // When checking this claim, note that the user chose this gender from these options: Man, Woman, Agender, Femboy, Intersex, Non-binary, Transgender, Trans woman, Trans man, and Other.
  // In equivocal cases, prefer probabilities near 1.0.
  image_1_has_claimed_gender: number

  // Image #1 contains a person whose age is: 26
  image_1_has_claimed_age: number

  // Image #1 contains a person whose age is 18 or older
  image_1_has_claimed_minimum_age: number

  // Image #1 contains a person whose primary or only ethnicity is: Black.
  // When checking this claim, note the user chose this ethnicity from these options: Black/African Descent, East Asian, Hispanic/Latino, Middle Eastern, Native American, Pacific Islander, South Asian, Southeast Asian, White/Caucasian, and Other.
  // In equivocal cases, prefer probabilities near 1.0.
  image_1_has_claimed_ethnicity: number

  // Image #1 contains a person who is smiling
  image_1_has_smiling_person: number

  // Image #1 contains a person whose hand is in contact with their eyebrow or a part of their face adjacent to their eyebrow (e.g. their forehead)
  image_1_has_eyebrow_touch: number

  // Image #1 contains a person whose thumb is visible
  image_1_has_thumb: number

  // Image #1 contains a person whose thumb is pointed downward
  image_1_has_downward_thumb: number

  // Image #1 contains a person who is in Image #2
  image_1_has_person_from_image_2: number

  // Image #1 contains a person who is in Image #3
  image_1_has_person_from_image_3: number

  // Image #1 contains a person who is in Image #4
  image_1_has_person_from_image_4: number

}
```
""".strip()
        )

    def test_get_system_content_without_ethnicity(self) -> None:
        self.maxDiff = 99999

        system_content = get_system_content(
            num_claimed_uuids=3,
            claimed_age=26,
            claimed_gender='Woman',
            claimed_ethnicity=None,
        )

        self.assertEqual(
            system_content,
            """
You have been given one or more image(s) by a user attempting to verify their identity on a social media website. The user provides Image #1 as proof of their identity. The user makes some claims about the image(s). Provide a JSON object in the following format which assigns a probability from 0.0 to 1.0 to each claim being true:

```typescript
{
  // Image #1 was not edited
  image_1_was_not_edited: number

  // Image #1 is a photograph
  image_1_is_photograph: number

  // Image #1 shows no signs of being a screenshot or photograph of a computer screen
  image_1_is_not_screenshot: number

  // Image #1 contains at least one person
  image_1_has_at_least_one_person: number

  // Image #1 contains exactly one person
  image_1_has_exactly_one_person: number

  // Image #1 contains a person whose gender is: Woman.
  // When checking this claim, note that the user chose this gender from these options: Man, Woman, Agender, Femboy, Intersex, Non-binary, Transgender, Trans woman, Trans man, and Other.
  // In equivocal cases, prefer probabilities near 1.0.
  image_1_has_claimed_gender: number

  // Image #1 contains a person whose age is: 26
  image_1_has_claimed_age: number

  // Image #1 contains a person whose age is 18 or older
  image_1_has_claimed_minimum_age: number

  // Image #1 contains a person who is smiling
  image_1_has_smiling_person: number

  // Image #1 contains a person whose hand is in contact with their eyebrow or a part of their face adjacent to their eyebrow (e.g. their forehead)
  image_1_has_eyebrow_touch: number

  // Image #1 contains a person whose thumb is visible
  image_1_has_thumb: number

  // Image #1 contains a person whose thumb is pointed downward
  image_1_has_downward_thumb: number

  // Image #1 contains a person who is in Image #2
  image_1_has_person_from_image_2: number

  // Image #1 contains a person who is in Image #3
  image_1_has_person_from_image_3: number

  // Image #1 contains a person who is in Image #4
  image_1_has_person_from_image_4: number

}
```
""".strip()
        )

if __name__ == '__main__':
    unittest.main()
