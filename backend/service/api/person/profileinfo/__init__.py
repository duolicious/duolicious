import logging
import secrets
from collections.abc import Mapping
from dataclasses import dataclass

import service.api.duotypes as t
from service.api.chat.chatutil import REDIS_WORKER_CLIENT
from service.api.chat.online import redis_publish_online
from service.api.duoaudio import put_audio_in_object_store
from service.api.person.aboutdiff import diff_addition_with_context
from service.api.person.duophoto import (
    CropSize,
    orient_image,
    photo_geometry,
    photo_geometry_params,
)
from service.api.person.images import (
    compute_blurhash,
    put_image_in_object_store,
)
from service.api.person.rudecheck import reject_rude_or_banned
from service.api.person.sql import *
from service.api.person.urlslug import assign_url_slug
from serviceshared.commonsql import *
from serviceshared.database import api_tx
from serviceshared.kvmatching.refresh import refresh_vectors

logger = logging.getLogger(__name__)


Q_PATCH_ABOUT = """
WITH updated_person AS (
    UPDATE person
    SET
        about = %(new_about)s::TEXT,

        last_event_time =
            CASE
                WHEN %(added_text)s::TEXT IS NULL
                THEN sign_up_time
                ELSE now()
            END,

        last_event_name =
            CASE
                WHEN %(added_text)s::TEXT IS NULL
                THEN 'joined'::person_event
                ELSE 'updated-bio'::person_event
            END,

        last_event_data =
            CASE
                WHEN %(added_text)s::TEXT IS NULL
                THEN
                    '{}'::JSONB
                ELSE
                    jsonb_build_object(
                        'added_text', %(added_text)s::TEXT,
                        'body_color', body_color,
                        'background_color', background_color
                    )
            END
    WHERE
        id = %(person_id)s
), updated_unmoderated_person AS (
    INSERT INTO
        unmoderated_person (person_id, trait)
    VALUES
        (%(person_id)s, 'about')
    ON CONFLICT DO NOTHING
)
SELECT 1
"""

Q_PATCH_PHOTO = """
WITH existing_uuid AS (
    SELECT
        uuid
    FROM
        photo
    WHERE
        person_id = %(person_id)s
    AND
        position = %(position)s
), undeleted_photo_insertion AS (
    INSERT INTO undeleted_photo (
        uuid
    )
    SELECT
        uuid
    FROM
        existing_uuid
), photo_insertion AS (
    INSERT INTO photo (
        person_id,
        position,
        uuid,
        blurhash,
        extra_exts,
        hash,
        width,
        height,
        crop_top,
        crop_left
    ) VALUES (
        %(person_id)s,
        %(position)s,
        %(uuid)s,
        %(blurhash)s,
        %(extra_exts)s,
        %(hash)s,
        %(width)s,
        %(height)s,
        %(crop_top)s,
        %(crop_left)s
    ) ON CONFLICT (person_id, position) DO UPDATE SET
        uuid = EXCLUDED.uuid,
        blurhash = EXCLUDED.blurhash,
        extra_exts = EXCLUDED.extra_exts,
        hash = EXCLUDED.hash,
        width = EXCLUDED.width,
        height = EXCLUDED.height,
        crop_top = EXCLUDED.crop_top,
        crop_left = EXCLUDED.crop_left,
        verified = FALSE
), updated_person AS (
    UPDATE person
    SET
        last_event_time = now(),
        last_event_name = 'added-photo',
        last_event_data = jsonb_build_object(
            'added_photo_uuid', %(uuid)s,
            'added_photo_blurhash', %(blurhash)s,
            'added_photo_extra_exts', %(extra_exts)s::TEXT[]
        )
    WHERE
        id = %(person_id)s
)
SELECT 1
"""

Q_PATCH_AUDIO = """
WITH existing_uuid AS (
    SELECT
        uuid
    FROM
        audio
    WHERE
        person_id = %(person_id)s
    AND
        position = -1
), undeleted_audio_insertion AS (
    INSERT INTO undeleted_audio (
        uuid
    )
    SELECT
        uuid
    FROM
        existing_uuid
), audio_insertion AS (
    INSERT INTO audio (
        person_id,
        position,
        uuid
    ) VALUES (
        %(person_id)s,
        -1,
        %(uuid)s
    ) ON CONFLICT (person_id, position) DO UPDATE SET
        uuid = EXCLUDED.uuid
), updated_person AS (
    UPDATE person
    SET
        last_event_time = now(),
        last_event_name = 'added-voice-bio',
        last_event_data = jsonb_build_object(
            'added_audio_uuid', %(uuid)s
        )
    WHERE
        id = %(person_id)s
)
SELECT 1
"""

Q_PATCH_LOCATION = """
UPDATE person
SET
    coordinates
        = location.coordinates,

    verification_required
        = location.verification_required OR person.verification_required,

    location_short_friendly
        = location.short_friendly,

    location_long_friendly
        = location.long_friendly,

    location_country
        = location.country
FROM location
WHERE person.id = %(person_id)s
AND long_friendly = %(field_value)s
"""

Q_PATCH_THEME = """
UPDATE person
SET
    title_color = %(title_color)s,
    body_color = %(body_color)s,
    background_color = %(background_color)s
WHERE id = %(person_id)s
"""

# The profile fields the matching model reads (person_rows_query in
# serviceshared/kvmatching/sql.py); changing anything else leaves the vector
# as it is.
KV_MODEL_PROFILE_FIELDS = frozenset((
    'gender', 'orientation', 'ethnicity', 'location', 'height',
    'looking_for', 'smoking', 'drinking', 'drugs', 'long_distance',
    'relationship_status', 'has_kids', 'wants_kids', 'exercise',
    'religion', 'star_sign',
))

@dataclass(frozen=True)
class _ProfileField:
    q1: str
    q2: str | None = None
    requires_gold: bool = False

def _person_lookup_q(column: str, table: str) -> str:
    return f"""
    UPDATE person SET {column} = {table}.id
    FROM {table}
    WHERE person.id = %(person_id)s
    AND {table}.name = %(field_value)s
    """


def _person_verified_lookup_q(column: str, table: str,
                              verified_column: str) -> str:
    return f"""
    UPDATE person
    SET {column} = {table}.id, {verified_column} = false
    FROM {table}
    WHERE person.id = %(person_id)s
    AND {table}.name = %(field_value)s
    AND person.{column} <> {table}.id
    """


def _person_yes_no_q(column: str) -> str:
    return f"""
    UPDATE person
    SET {column} = (
        CASE WHEN %(field_value)s = 'Yes' THEN TRUE ELSE FALSE END)
    WHERE id = %(person_id)s
    """


def _person_value_q(column: str) -> str:
    return f"""
    UPDATE person SET {column} = %(field_value)s
    WHERE person.id = %(person_id)s
    """

_PROFILE_FIELDS = {
    'gender': _ProfileField(
        q1=_person_verified_lookup_q('gender_id', 'gender', 'verified_gender'),
        q2=Q_UPDATE_VERIFICATION_LEVEL,
    ),
    'orientation': _ProfileField(
        q1=_person_lookup_q('orientation_id', 'orientation')),
    'ethnicity': _ProfileField(
        q1=_person_verified_lookup_q(
            'ethnicity_id', 'ethnicity', 'verified_ethnicity'),
        q2=Q_UPDATE_VERIFICATION_LEVEL,
    ),
    'location': _ProfileField(q1=Q_PATCH_LOCATION),
    'occupation': _ProfileField(q1=_person_value_q('occupation')),
    'education': _ProfileField(q1=_person_value_q('education')),
    'height': _ProfileField(q1=_person_value_q('height_cm')),
    'looking_for': _ProfileField(
        q1=_person_lookup_q('looking_for_id', 'looking_for')),
    'smoking': _ProfileField(
        q1=_person_lookup_q('smoking_id', 'yes_no_optional')),
    'drinking': _ProfileField(q1=_person_lookup_q('drinking_id', 'frequency')),
    'drugs': _ProfileField(q1=_person_lookup_q('drugs_id', 'yes_no_optional')),
    'long_distance': _ProfileField(
        q1=_person_lookup_q('long_distance_id', 'yes_no_optional')),
    'relationship_status': _ProfileField(
        q1=_person_lookup_q('relationship_status_id', 'relationship_status')),
    'has_kids': _ProfileField(
        q1=_person_lookup_q('has_kids_id', 'yes_no_maybe')),
    'wants_kids': _ProfileField(
        q1=_person_lookup_q('wants_kids_id', 'yes_no_maybe')),
    'exercise': _ProfileField(q1=_person_lookup_q('exercise_id', 'frequency')),
    'religion': _ProfileField(q1=_person_lookup_q('religion_id', 'religion')),
    'star_sign': _ProfileField(q1=_person_lookup_q('star_sign_id', 'star_sign')),
    'units': _ProfileField(q1=_person_lookup_q('unit_id', 'unit')),
    'chats': _ProfileField(
        q1=_person_lookup_q('chats_notification', 'immediacy')),
    'intros': _ProfileField(
        q1=_person_lookup_q('intros_notification', 'immediacy')),
    'visitors': _ProfileField(
        q1=_person_lookup_q('visitors_notification', 'immediacy')),
    'verification_level': _ProfileField(
        q1=_person_lookup_q(
            'privacy_verification_level_id', 'verification_level')),
    'show_my_location': _ProfileField(
        q1=_person_lookup_q('show_my_location_id', 'yes_country_only_no'),
        requires_gold=True,
    ),
    'show_my_age': _ProfileField(
        q1=_person_yes_no_q('show_my_age'), requires_gold=True),
    'show_my_looking_for': _ProfileField(
        q1=_person_yes_no_q('show_my_looking_for'), requires_gold=True),
    'hide_me_from_strangers': _ProfileField(
        q1=_person_yes_no_q('hide_me_from_strangers'), requires_gold=True),
    'browse_invisibly': _ProfileField(
        q1=_person_yes_no_q('browse_invisibly'), requires_gold=True),
    'show_my_online_status': _ProfileField(
        q1=_person_yes_no_q('show_my_online_status')),
    'public_profile': _ProfileField(q1=_person_yes_no_q('public_profile')),
    'theme': _ProfileField(q1=Q_PATCH_THEME, requires_gold=True),
}

async def _has_gold(person_id: int) -> bool:
    async with api_tx() as tx:
        row = await tx.require_one(Q_HAS_GOLD, dict(person_id=person_id))
    return row.get('has_gold', False)


def _str_value(value: object, field_name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f'Field {field_name} must be a string')
    return value


async def get_profile_info(s: t.SessionInfo) -> object:
    params = dict(person_id=s.person_id)

    async with api_tx('READ COMMITTED') as tx:
        return (await tx.require_one(Q_GET_PROFILE_INFO, params))['j']

async def delete_profile_info(req: t.DeleteProfileInfo, s: t.SessionInfo) -> None:
    files_params = [
        dict(person_id=s.person_id, position=position)
        for position in req.files or []
    ]

    audio_files_params = [
        dict(person_id=s.person_id, position=-1)
        for position in req.audio_files or []
    ]

    if files_params:
        async with api_tx() as tx:
            await tx.executemany(Q_DELETE_PROFILE_INFO_PHOTO, files_params)
            await tx.execute(Q_UPDATE_VERIFICATION_LEVEL, files_params[0])

    if audio_files_params:
        async with api_tx() as tx:
            await tx.executemany(Q_DELETE_PROFILE_INFO_AUDIO, audio_files_params)


async def _patch_profile_info_about(
    person_id: int,
    new_about: str,
) -> None:
    select = """
    SELECT about AS old_about FROM person WHERE id = %(person_id)s
    """

    async with api_tx() as tx:
        select_params = dict(
            person_id=person_id,
        )

        old_about = (await tx.require_one(select, select_params))['old_about']

        update_params = dict(
            person_id=person_id,
            new_about=new_about,
            added_text=diff_addition_with_context(old=old_about, new=new_about),
        )

        await tx.execute(Q_PATCH_ABOUT, update_params)


async def _patch_photo(person_id: int, field_value: object) -> object:
    base64_file = t.Base64File.model_validate(field_value)

    crop_size = CropSize(
            top=base64_file.top,
            left=base64_file.left)
    uuid = secrets.token_hex(32)
    blurhash_ = compute_blurhash(base64_file.image, crop_size=crop_size)
    extra_exts = ['gif'] if base64_file.image.format == 'GIF' else []
    geometry = photo_geometry(
        *orient_image(base64_file.image).size,
        crop_size,
    )

    params = dict(
        person_id=person_id,
        position=base64_file.position,
        uuid=uuid,
        blurhash=blurhash_,
        extra_exts=extra_exts,
        hash=base64_file.md5_hash,
        **photo_geometry_params(geometry),
    )

    async with api_tx() as tx:
        await tx.execute(Q_PATCH_PHOTO, params)
        await tx.execute(Q_UPDATE_VERIFICATION_LEVEL, params)

    try:
        await put_image_in_object_store(uuid, base64_file, crop_size)
    except:
        logger.exception('Storing image failed')
        return '', 500

    return None


async def _patch_audio(person_id: int, field_value: object) -> object:
    base64_audio_file = t.Base64AudioFile.model_validate(field_value)

    uuid = secrets.token_hex(32)

    params = dict(
        person_id=person_id,
        uuid=uuid,
    )

    async with api_tx() as tx:
        await tx.execute(Q_PATCH_AUDIO, params)

    try:
        await put_audio_in_object_store(
            uuid=uuid,
            audio_file_bytes=base64_audio_file.transcoded,
        )
    except:
        logger.exception('Storing audio failed')
        return '', 500

    return None


async def _patch_photo_assignments(
        person_id: int, photo_assignments: Mapping[int, int]) -> None:
    case_sql = '\n'.join(
        f'WHEN position = {int(k)} THEN {int(v)}'
        for k, v in photo_assignments.items()
    )

    params = dict(person_id=person_id)

    # We set the positions to negative indexes first, to avoid violating
    # uniqueness constraints
    q1 = f"""
    UPDATE
        photo
    SET
        position = - (CASE {case_sql} ELSE position END)
    WHERE
        person_id = %(person_id)s
    """

    q2 = """
    UPDATE
        photo
    SET
        position = ABS(position)
    WHERE
        person_id = %(person_id)s
    """

    async with api_tx() as tx:
        await tx.execute(q1, params)
        await tx.execute(q2, params)


async def _patch_name(person_id: int, field_value: object) -> object:
    if not await _has_gold(person_id=person_id):
        return 'Requires gold', 403

    params = dict(person_id=person_id, field_value=field_value)

    async with api_tx() as tx:
        await tx.execute(
            "UPDATE person SET name = %(field_value)s WHERE id = %(person_id)s",
            params,
        )
        return await assign_url_slug(tx, person_id)


async def patch_profile_info(req: t.PatchProfileInfo, s: t.SessionInfo) -> object:
    if not s.person_id:
        return 'Not authorized', 400

    [field_name] = req.__pydantic_fields_set__

    await reject_rude_or_banned(field_name, req)

    if field_name == 'photo_assignments':
        if req.photo_assignments is None:
            raise ValueError('Field photo_assignments must not be None')
        await _patch_photo_assignments(
            s.person_id, req.photo_assignments.root)
        return None

    field_value: object = req.dict()[field_name]
    if field_value is None and field_name in t.PATCH_PROFILE_INFO_LOOKUP_BASICS:
        field_value = 'Unanswered'

    if field_name == 'base64_file':
        return await _patch_photo(s.person_id, field_value)
    if field_name == 'base64_audio_file':
        return await _patch_audio(s.person_id, field_value)
    if field_name == 'name':
        return await _patch_name(s.person_id, field_value)
    if field_name == 'about':
        await _patch_profile_info_about(
            s.person_id,
            _str_value(field_value, field_name),
        )
        return None

    field = _PROFILE_FIELDS.get(field_name)
    if field is None:
        return f'Unhandled field name {field_name}', 500

    if field.requires_gold and not await _has_gold(person_id=s.person_id):
        return 'Requires gold', 403

    params = dict(
        person_id=s.person_id,
        field_value=field_value,
    )

    if field_name == 'theme':
        try:
            theme = t.Theme.model_validate(field_value)
            params.update(
                dict(
                    title_color=theme.title_color,
                    body_color=theme.body_color,
                    background_color=theme.background_color,
                )
            )
        except:
            return f'Invalid colors', 400

    async with api_tx() as tx:
        await tx.execute(field.q1, params)
        if field.q2:
            await tx.execute(field.q2, params)
        if field_name in KV_MODEL_PROFILE_FIELDS:
            await refresh_vectors(tx, s.person_id)

    if field_name == 'show_my_online_status' and s.person_uuid is not None:
        await redis_publish_online(
            redis_client=REDIS_WORKER_CLIENT,
            username=s.person_uuid,
            visible=field_value == 'Yes',
        )

    return None
