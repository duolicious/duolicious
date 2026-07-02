from openai import AsyncOpenAI
from openai.types.chat import (
    ChatCompletionContentPartImageParam,
    ChatCompletionContentPartTextParam,
    ChatCompletionMessageParam,
    ChatCompletionSystemMessageParam,
    ChatCompletionUserMessageParam,
)
from openai.types.shared_params.response_format_json_object import (
    ResponseFormatJSONObject,
)
from dataclasses import dataclass
from typing import Literal
import json
import os
import base64
import traceback
from pathlib import Path
from httpxclient import make_http_client
from verification.messages import *

VERIFICATION_IMAGE_BASE_URL = os.getenv('DUO_VERIFICATION_IMAGE_BASE_URL')
VERIFICATION_MOCK_RESPONSE_FILE = os.getenv('DUO_VERIFICATION_MOCK_RESPONSE_FILE')

_mock_response_file = (
     Path(__file__).parent.parent / VERIFICATION_MOCK_RESPONSE_FILE
     if VERIFICATION_MOCK_RESPONSE_FILE else None)


def get_system_content(
    num_claimed_uuids: int,
    claimed_age: int,
    claimed_gender: str,
    claimed_ethnicity: str | None
) -> str:
    ethnicity_lines = (
        [
            f'  // Image #1 contains a person whose primary or only ethnicity is: {claimed_ethnicity}.\n'
            f'  // When checking this claim, note the user chose this ethnicity from these options: Black/African Descent, East Asian, Hispanic/Latino, Middle Eastern, Native American, Pacific Islander, South Asian, Southeast Asian, White/Caucasian, and Other.\n'
            f'  // In equivocal cases, prefer probabilities near 1.0.',
            f'  image_1_has_claimed_ethnicity: number\n'
        ]
        if claimed_ethnicity
        else [])

    image_lines = [
        f'  // Image #1 contains a person who is in Image #{i + 2}\n'
        f'  image_1_has_person_from_image_{i + 2}: number\n'
        for i in range(num_claimed_uuids)
    ]

    content = '\n'.join([
        'You have been given one or more image(s) by a user attempting to '
        'verify their identity on a social media website. The user provides '
        'Image #1 as proof of their identity. The user makes some claims about '
        'the image(s). Provide a JSON object in the following format which '
        'assigns a probability from 0.0 to 1.0 to each claim being true:',
        '',
        '```typescript',
        '{',
        '  // Image #1 was not edited',
        '  image_1_was_not_edited: number',
        '',
        '  // Image #1 is a photograph',
        '  image_1_is_photograph: number',
        '',
        '  // Image #1 shows no signs of being a screenshot or photograph of a computer screen',
        '  image_1_is_not_screenshot: number',
        '',
        '  // Image #1 contains at least one person',
        '  image_1_has_at_least_one_person: number',
        '',
        '  // Image #1 contains exactly one person',
        '  image_1_has_exactly_one_person: number',
        '',
        f'  // Image #1 contains a person whose gender is: {claimed_gender}.',
        f'  // When checking this claim, note that the user chose this gender from these options: Man, Woman, Agender, Femboy, Intersex, Non-binary, Transgender, Trans woman, Trans man, and Other.',
        f'  // In equivocal cases, prefer probabilities near 1.0.',
        '  image_1_has_claimed_gender: number',
        '',
        f'  // Image #1 contains a person whose age is: {claimed_age}',
        '  image_1_has_claimed_age: number',
        '',
        f'  // Image #1 contains a person whose age is 18 or older',
        '  image_1_has_claimed_minimum_age: number',
        '',
        *ethnicity_lines,
        '  // Image #1 contains a person who is smiling',
        '  image_1_has_smiling_person: number',
        '',
        '  // Image #1 contains a person whose hand is in contact with their eyebrow or a part of their face adjacent to their eyebrow (e.g. their forehead)',
        '  image_1_has_eyebrow_touch: number',
        '',
        '  // Image #1 contains a person whose thumb is visible',
        '  image_1_has_thumb: number',
        '',
        '  // Image #1 contains a person whose thumb is pointed downward',
        '  image_1_has_downward_thumb: number',
        '',
        *image_lines,
        '}',
        '```',
    ])

    return content


async def get_user_content(
    proof_uuid: str,
    claimed_uuids: list[str],
) -> list[ChatCompletionContentPartTextParam | ChatCompletionContentPartImageParam]:
    content: list[
        ChatCompletionContentPartTextParam | ChatCompletionContentPartImageParam
    ] = []

    for i, uuid in enumerate([proof_uuid] + claimed_uuids):
        content.append({
            "type": "text",
            "text": f"Image #{i + 1}:",
        })
        content.append({
            "type": "image_url",
            "image_url": {
                "url": await get_image_url(uuid),
                "detail": "high" if i == 0 else "low"
            }
        })

    return content


@dataclass(frozen=True)
class Success:
    verified_uuids: list[str]

    is_verified_age: bool
    is_verified_gender: bool
    is_verified_ethnicity: bool

    raw_json: str


@dataclass(frozen=True)
class Failure:
    reason: str
    raw_json: str


@dataclass(frozen=True)
class VerificationResult:
    success: Success | None
    failure: Failure | None


def failure(
    reason: str,
    raw_json: str,
) -> VerificationResult:
    return VerificationResult(
        success=None,
        failure=Failure(
            reason=reason,
            raw_json=raw_json,
        ),
    )


def success(
    verified_uuids: list[str],
    is_verified_age: bool,
    is_verified_gender: bool,
    is_verified_ethnicity: bool,
    raw_json: str,
) -> VerificationResult:
    return VerificationResult(
        success=Success(
            verified_uuids=verified_uuids,
            is_verified_age=is_verified_age,
            is_verified_gender=is_verified_gender,
            is_verified_ethnicity=is_verified_ethnicity,
            raw_json=raw_json,
        ),
        failure=None,
    )


def process_response(
    response: str | None,
    claimed_uuids: list[str],
) -> VerificationResult:
    response_str = str(response)

    try:
        assert response
        json_obj = json.loads(response)

        image_1_was_not_edited          = json_obj['image_1_was_not_edited']
        image_1_is_photograph           = json_obj['image_1_is_photograph']
        image_1_is_not_screenshot       = json_obj['image_1_is_not_screenshot']
        image_1_has_at_least_one_person = json_obj['image_1_has_at_least_one_person']
        image_1_has_exactly_one_person  = json_obj['image_1_has_exactly_one_person']
        image_1_has_claimed_gender      = json_obj['image_1_has_claimed_gender']
        image_1_has_claimed_age         = json_obj['image_1_has_claimed_age']
        image_1_has_claimed_minimum_age = json_obj['image_1_has_claimed_minimum_age']
        image_1_has_claimed_ethnicity   = json_obj.get('image_1_has_claimed_ethnicity')
        image_1_has_smiling_person      = json_obj['image_1_has_smiling_person']
        image_1_has_eyebrow_touch       = json_obj['image_1_has_eyebrow_touch']
        image_1_has_downward_thumb      = json_obj['image_1_has_downward_thumb']
        image_1_has_person_from_image_2 = json_obj.get('image_1_has_person_from_image_2')
        image_1_has_person_from_image_3 = json_obj.get('image_1_has_person_from_image_3')
        image_1_has_person_from_image_4 = json_obj.get('image_1_has_person_from_image_4')
        image_1_has_person_from_image_5 = json_obj.get('image_1_has_person_from_image_5')
        image_1_has_person_from_image_6 = json_obj.get('image_1_has_person_from_image_6')
        image_1_has_person_from_image_7 = json_obj.get('image_1_has_person_from_image_7')
        image_1_has_person_from_image_8 = json_obj.get('image_1_has_person_from_image_8')

        image_1_was_not_edited          = float(image_1_was_not_edited)
        image_1_is_photograph           = float(image_1_is_photograph)
        image_1_is_not_screenshot       = float(image_1_is_not_screenshot)
        image_1_has_at_least_one_person = float(image_1_has_at_least_one_person)
        image_1_has_exactly_one_person  = float(image_1_has_exactly_one_person)
        image_1_has_claimed_gender      = float(image_1_has_claimed_gender)
        image_1_has_claimed_age         = float(image_1_has_claimed_age)
        image_1_has_claimed_minimum_age = float(image_1_has_claimed_minimum_age)
        image_1_has_claimed_ethnicity   = float(image_1_has_claimed_ethnicity) if image_1_has_claimed_ethnicity is not None else None
        image_1_has_smiling_person      = float(image_1_has_smiling_person)
        image_1_has_eyebrow_touch       = float(image_1_has_eyebrow_touch)
        image_1_has_downward_thumb      = float(image_1_has_downward_thumb)
        image_1_has_person_from_image_2 = float(image_1_has_person_from_image_2) if image_1_has_person_from_image_2 is not None else None
        image_1_has_person_from_image_3 = float(image_1_has_person_from_image_3) if image_1_has_person_from_image_3 is not None else None
        image_1_has_person_from_image_4 = float(image_1_has_person_from_image_4) if image_1_has_person_from_image_4 is not None else None
        image_1_has_person_from_image_5 = float(image_1_has_person_from_image_5) if image_1_has_person_from_image_5 is not None else None
        image_1_has_person_from_image_6 = float(image_1_has_person_from_image_6) if image_1_has_person_from_image_6 is not None else None
        image_1_has_person_from_image_7 = float(image_1_has_person_from_image_7) if image_1_has_person_from_image_7 is not None else None
        image_1_has_person_from_image_8 = float(image_1_has_person_from_image_8) if image_1_has_person_from_image_8 is not None else None
    except:
        print(traceback.format_exc())
        print('JSON was:', response_str)
        return failure(V_SOMETHING_WENT_WRONG, response_str)

    # These settings are tuned to gpt-4-turbo. gpt-4o worked better with higher
    # numbers.
    #
    # edit_truthiness_threshold = 0.8
    # gender_truthiness_threshold = 0.5
    # age_truthiness_threshold = 0.5
    # minimum_age_truthiness_threshold = 0.8
    # ethnicity_truthiness_threshold = 0.4
    # photo_truthiness_threshold = 0.9

    # These settings are tuned to gpt-4o-2024-08-06
    photo_truthiness_threshold = 0.9

    is_uuid_verified_seq = [
        (image_1_has_person_from_image_2 or 0.0) >= photo_truthiness_threshold,
        (image_1_has_person_from_image_3 or 0.0) >= photo_truthiness_threshold,
        (image_1_has_person_from_image_4 or 0.0) >= photo_truthiness_threshold,
        (image_1_has_person_from_image_5 or 0.0) >= photo_truthiness_threshold,
        (image_1_has_person_from_image_6 or 0.0) >= photo_truthiness_threshold,
        (image_1_has_person_from_image_7 or 0.0) >= photo_truthiness_threshold,
        (image_1_has_person_from_image_8 or 0.0) >= photo_truthiness_threshold,
    ]
    verified_uuids = [
        uuid
        for uuid, is_uuid_verified in zip(claimed_uuids, is_uuid_verified_seq)
        if is_uuid_verified]

    general_truthiness_threshold = 0.7

    edit_truthiness_threshold = 0.8
    gender_truthiness_threshold = 0.5
    age_truthiness_threshold = 0.5
    minimum_age_truthiness_threshold = 0.8
    ethnicity_truthiness_threshold = 0.4

    if image_1_is_photograph < general_truthiness_threshold:
        return failure(V_NOT_REAL, response_str)

    if image_1_is_not_screenshot < general_truthiness_threshold:
        return failure(V_SCREENSHOT, response_str)

    if image_1_was_not_edited < edit_truthiness_threshold:
        return failure(V_EDITED, response_str)

    if image_1_has_at_least_one_person < general_truthiness_threshold:
        return failure(V_NO_PEOPLE, response_str)

    if image_1_has_exactly_one_person < general_truthiness_threshold:
        return failure(V_MANY_PEOPLE, response_str)

    if image_1_has_claimed_gender < gender_truthiness_threshold:
        return failure(V_GENDER, response_str)

    if (
            image_1_has_claimed_ethnicity is not None and
            image_1_has_claimed_ethnicity < ethnicity_truthiness_threshold):
        return failure(V_ETHNCITY, response_str)

    if image_1_has_claimed_age < age_truthiness_threshold:
        return failure(V_AGE, response_str)

    if image_1_has_claimed_minimum_age < minimum_age_truthiness_threshold:
        return failure(V_AGE, response_str)

    if image_1_has_smiling_person < general_truthiness_threshold:
        return failure(V_SMILING, response_str)

    if image_1_has_eyebrow_touch < general_truthiness_threshold:
        return failure(V_EYEBROW, response_str)

    if image_1_has_downward_thumb < general_truthiness_threshold:
        return failure(V_THUMBS_DOWN, response_str)

    return success(
        verified_uuids=verified_uuids,
        is_verified_age=True,
        is_verified_gender=True,
        is_verified_ethnicity=image_1_has_claimed_ethnicity is not None,
        raw_json=response_str,
    )


async def get_image_url(uuid: str) -> str:
    if not VERIFICATION_IMAGE_BASE_URL:
        return f"https://user-images.duolicious.app/450-{uuid}.jpg"

    # Everything after this point is only intended for use in development.
    # This shouldn't be used in production.
    intermediate_image_url = f"{VERIFICATION_IMAGE_BASE_URL}/450-{uuid}.jpg"
    print(f'Fetching for verification: {intermediate_image_url}')

    async with make_http_client() as client:
        response = await client.get(intermediate_image_url)
        response.raise_for_status()
        data = response.content

    base64_encoded_str = base64.b64encode(data).decode('utf-8')

    return f"data:image/jpeg;base64,{base64_encoded_str}"


async def get_messages(
    proof_uuid: str,
    claimed_uuids: list[str],
    claimed_age: int,
    claimed_gender: str,
    claimed_ethnicity: str | None,
) -> list[ChatCompletionMessageParam]:
    system_message: ChatCompletionSystemMessageParam = {
        "role": "system",
        "content": get_system_content(
            num_claimed_uuids=len(claimed_uuids),
            claimed_age=claimed_age,
            claimed_gender=claimed_gender,
            claimed_ethnicity=claimed_ethnicity,
        )
    }
    user_message: ChatCompletionUserMessageParam = {
        "role": "user",
        "content": await get_user_content(
            proof_uuid,
            claimed_uuids,
        )
    }
    return [
        system_message,
        user_message,
    ]


async def mock_verification_response(
    proof_uuid: str,
    claimed_uuids: list[str],
    claimed_age: int,
    claimed_gender: str,
    claimed_ethnicity: str | None,
) -> str | None:
    if _mock_response_file and _mock_response_file.exists():
        with _mock_response_file.open('r') as f:
            return f.read()
    else:
        return None


async def real_verification_response(
    proof_uuid: str,
    claimed_uuids: list[str],
    claimed_age: int,
    claimed_gender: str,
    claimed_ethnicity: str | None,
) -> str | None:
    response_format: ResponseFormatJSONObject = {"type": "json_object"}
    try:
        return (await AsyncOpenAI().chat.completions.create(
            model="gpt-4.1-2025-04-14",
            response_format=response_format,
            temperature=0.0,
            frequency_penalty=0.0,
            presence_penalty=0.0,
            messages=await get_messages(
                proof_uuid=proof_uuid,
                claimed_uuids=claimed_uuids,
                claimed_age=claimed_age,
                claimed_gender=claimed_gender,
                claimed_ethnicity=claimed_ethnicity,
            ),
            max_tokens=500,
            timeout=45,
        )).choices[0].message.content
    except:
        print(traceback.format_exc())

    return None


async def verify(
    proof_uuid: str,
    claimed_uuids: list[str],
    claimed_age: int,
    claimed_gender: str,
    claimed_ethnicity: str | None,
) -> VerificationResult:
    if _mock_response_file and _mock_response_file.exists():
        response = await mock_verification_response(
            proof_uuid=proof_uuid,
            claimed_uuids=claimed_uuids,
            claimed_age=claimed_age,
            claimed_gender=claimed_gender,
            claimed_ethnicity=claimed_ethnicity,
        )
    else:
        response = await real_verification_response(
            proof_uuid=proof_uuid,
            claimed_uuids=claimed_uuids,
            claimed_age=claimed_age,
            claimed_gender=claimed_gender,
            claimed_ethnicity=claimed_ethnicity,
        )

    return process_response(response, claimed_uuids)
