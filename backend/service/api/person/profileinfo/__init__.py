import logging
import secrets

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

logger = logging.getLogger(__name__)

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

    update = """
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

        await tx.execute(update, update_params)

async def patch_profile_info(req: t.PatchProfileInfo, s: t.SessionInfo) -> object:
    if not s.person_id:
        return 'Not authorized', 400

    [field_name] = req.__pydantic_fields_set__

    await reject_rude_or_banned(field_name, req)
    field_value: object
    if field_name == 'photo_assignments':
        if req.photo_assignments is None:
            raise ValueError('Field photo_assignments must not be None')
        field_value = req.photo_assignments.root
    else:
        field_value = req.dict()[field_name]

    if field_value is None and field_name in t.PATCH_PROFILE_INFO_LOOKUP_BASICS:
        field_value = 'Unanswered'

    params = dict(
        person_id=s.person_id,
        field_value=field_value,
    )

    q1 = None
    q2 = None

    uuid = None
    base64_file = None
    crop_size = None

    base64_audio_file = None

    if field_name == 'base64_file':
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
            person_id=s.person_id,
            position=base64_file.position,
            uuid=uuid,
            blurhash=blurhash_,
            extra_exts=extra_exts,
            hash=base64_file.md5_hash,
            **photo_geometry_params(geometry),
        )

        q1 = """
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

        q2 = Q_UPDATE_VERIFICATION_LEVEL
    elif field_name == 'base64_audio_file':
        base64_audio_file = t.Base64AudioFile.model_validate(field_value)

        uuid = secrets.token_hex(32)

        params = dict(
            person_id=s.person_id,
            uuid=uuid,
        )

        q1 = """
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
    elif field_name == 'photo_assignments':
        if req.photo_assignments is None:
            raise ValueError('Field photo_assignments must not be None')
        photo_assignments = req.photo_assignments.root
        case_sql = '\n'.join(
            f'WHEN position = {int(k)} THEN {int(v)}'
            for k, v in photo_assignments.items()
        )

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
    elif field_name == 'name':
        if not await _has_gold(person_id=s.person_id):
            return 'Requires gold', 403

        async with api_tx() as tx:
            await tx.execute(
                "UPDATE person SET name = %(field_value)s WHERE id = %(person_id)s",
                params,
            )
            slug = await assign_url_slug(tx, s.person_id)

        return slug
    elif field_name == 'about':
        await _patch_profile_info_about(
            s.person_id,
            _str_value(field_value, field_name),
        )
        return None
    elif field_name == 'gender':
        q1 = """
        UPDATE person
        SET gender_id = gender.id, verified_gender = false
        FROM gender
        WHERE person.id = %(person_id)s
        AND gender.name = %(field_value)s
        AND person.gender_id <> gender.id
        """

        q2 = Q_UPDATE_VERIFICATION_LEVEL
    elif field_name == 'orientation':
        q1 = """
        UPDATE person SET orientation_id = orientation.id
        FROM orientation
        WHERE person.id = %(person_id)s
        AND orientation.name = %(field_value)s
        """
    elif field_name == 'ethnicity':
        q1 = """
        UPDATE person
        SET ethnicity_id = ethnicity.id, verified_ethnicity = false
        FROM ethnicity
        WHERE person.id = %(person_id)s
        AND ethnicity.name = %(field_value)s
        AND person.ethnicity_id <> ethnicity.id
        """

        q2 = Q_UPDATE_VERIFICATION_LEVEL
    elif field_name == 'location':
        q1 = """
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
    elif field_name == 'occupation':
        q1 = """
        UPDATE person SET occupation = %(field_value)s
        WHERE person.id = %(person_id)s
        """
    elif field_name == 'education':
        q1 = """
        UPDATE person SET education = %(field_value)s
        WHERE person.id = %(person_id)s
        """
    elif field_name == 'height':
        q1 = """
        UPDATE person SET height_cm = %(field_value)s
        WHERE person.id = %(person_id)s
        """
    elif field_name == 'looking_for':
        q1 = """
        UPDATE person SET looking_for_id = looking_for.id
        FROM looking_for
        WHERE person.id = %(person_id)s
        AND looking_for.name = %(field_value)s
        """
    elif field_name == 'smoking':
        q1 = """
        UPDATE person SET smoking_id = yes_no_optional.id
        FROM yes_no_optional
        WHERE person.id = %(person_id)s
        AND yes_no_optional.name = %(field_value)s
        """
    elif field_name == 'drinking':
        q1 = """
        UPDATE person SET drinking_id = frequency.id
        FROM frequency
        WHERE person.id = %(person_id)s
        AND frequency.name = %(field_value)s
        """
    elif field_name == 'drugs':
        q1 = """
        UPDATE person SET drugs_id = yes_no_optional.id
        FROM yes_no_optional
        WHERE person.id = %(person_id)s
        AND yes_no_optional.name = %(field_value)s
        """
    elif field_name == 'long_distance':
        q1 = """
        UPDATE person SET long_distance_id = yes_no_optional.id
        FROM yes_no_optional
        WHERE person.id = %(person_id)s
        AND yes_no_optional.name = %(field_value)s
        """
    elif field_name == 'relationship_status':
        q1 = """
        UPDATE person SET relationship_status_id = relationship_status.id
        FROM relationship_status
        WHERE person.id = %(person_id)s
        AND relationship_status.name = %(field_value)s
        """
    elif field_name == 'has_kids':
        q1 = """
        UPDATE person SET has_kids_id = yes_no_maybe.id
        FROM yes_no_maybe
        WHERE person.id = %(person_id)s
        AND yes_no_maybe.name = %(field_value)s
        """
    elif field_name == 'wants_kids':
        q1 = """
        UPDATE person SET wants_kids_id = yes_no_maybe.id
        FROM yes_no_maybe
        WHERE person.id = %(person_id)s
        AND yes_no_maybe.name = %(field_value)s
        """
    elif field_name == 'exercise':
        q1 = """
        UPDATE person SET exercise_id = frequency.id
        FROM frequency
        WHERE person.id = %(person_id)s
        AND frequency.name = %(field_value)s
        """
    elif field_name == 'religion':
        q1 = """
        UPDATE person SET religion_id = religion.id
        FROM religion
        WHERE person.id = %(person_id)s
        AND religion.name = %(field_value)s
        """
    elif field_name == 'star_sign':
        q1 = """
        UPDATE person SET star_sign_id = star_sign.id
        FROM star_sign
        WHERE person.id = %(person_id)s
        AND star_sign.name = %(field_value)s
        """
    elif field_name == 'units':
        q1 = """
        UPDATE person SET unit_id = unit.id
        FROM unit
        WHERE person.id = %(person_id)s
        AND unit.name = %(field_value)s
        """
    elif field_name == 'chats':
        q1 = """
        UPDATE person SET chats_notification = immediacy.id
        FROM immediacy
        WHERE person.id = %(person_id)s
        AND immediacy.name = %(field_value)s
        """
    elif field_name == 'intros':
        q1 = """
        UPDATE person SET intros_notification = immediacy.id
        FROM immediacy
        WHERE person.id = %(person_id)s
        AND immediacy.name = %(field_value)s
        """
    elif field_name == 'visitors':
        q1 = """
        UPDATE person SET visitors_notification = immediacy.id
        FROM immediacy
        WHERE person.id = %(person_id)s
        AND immediacy.name = %(field_value)s
        """
    elif field_name == 'verification_level':
        q1 = """
        UPDATE person
        SET privacy_verification_level_id = verification_level.id
        FROM verification_level
        WHERE person.id = %(person_id)s AND
        verification_level.name = %(field_value)s
        """
    elif field_name == 'show_my_location':
        if not await _has_gold(person_id=s.person_id):
            return 'Requires gold', 403

        q1 = """
        UPDATE person
        SET show_my_location_id = yes_country_only_no.id
        FROM yes_country_only_no
        WHERE person.id = %(person_id)s
        AND yes_country_only_no.name = %(field_value)s
        """
    elif field_name == 'show_my_age':
        if not await _has_gold(person_id=s.person_id):
            return 'Requires gold', 403

        q1 = """
        UPDATE person
        SET show_my_age = (
            CASE WHEN %(field_value)s = 'Yes' THEN TRUE ELSE FALSE END)
        WHERE id = %(person_id)s
        """
    elif field_name == 'show_my_looking_for':
        if not await _has_gold(person_id=s.person_id):
            return 'Requires gold', 403

        q1 = """
        UPDATE person
        SET show_my_looking_for = (
            CASE WHEN %(field_value)s = 'Yes' THEN TRUE ELSE FALSE END)
        WHERE id = %(person_id)s
        """
    elif field_name == 'hide_me_from_strangers':
        if not await _has_gold(person_id=s.person_id):
            return 'Requires gold', 403

        q1 = """
        UPDATE person
        SET hide_me_from_strangers = (
            CASE WHEN %(field_value)s = 'Yes' THEN TRUE ELSE FALSE END)
        WHERE id = %(person_id)s
        """
    elif field_name == 'browse_invisibly':
        if not await _has_gold(person_id=s.person_id):
            return 'Requires gold', 403

        q1 = """
        UPDATE person
        SET browse_invisibly = (
            CASE WHEN %(field_value)s = 'Yes' THEN TRUE ELSE FALSE END)
        WHERE id = %(person_id)s
        """
    elif field_name == 'show_my_online_status':
        q1 = """
        UPDATE person
        SET show_my_online_status = (
            CASE WHEN %(field_value)s = 'Yes' THEN TRUE ELSE FALSE END)
        WHERE id = %(person_id)s
        """
    elif field_name == 'public_profile':
        q1 = """
        UPDATE person
        SET public_profile = (
            CASE WHEN %(field_value)s = 'Yes' THEN TRUE ELSE FALSE END)
        WHERE id = %(person_id)s
        """
    elif field_name == 'theme':
        if not await _has_gold(person_id=s.person_id):
            return 'Requires gold', 403

        try:
            theme = t.Theme.model_validate(field_value)
            title_color = theme.title_color
            body_color = theme.body_color
            background_color = theme.background_color

            params.update(
                dict(
                    title_color=title_color,
                    body_color=body_color,
                    background_color=background_color,
                )
            )
        except:
            return f'Invalid colors', 400

        q1 = """
        UPDATE person
        SET
            title_color = %(title_color)s,
            body_color = %(body_color)s,
            background_color = %(background_color)s
        WHERE id = %(person_id)s
        """
    else:
        return f'Unhandled field name {field_name}', 500

    async with api_tx() as tx:
        if q1: await tx.execute(q1, params)
        if q2: await tx.execute(q2, params)

    if field_name == 'show_my_online_status' and s.person_uuid is not None:
        await redis_publish_online(
            redis_client=REDIS_WORKER_CLIENT,
            username=s.person_uuid,
            visible=field_value == 'Yes',
        )

    if uuid and base64_file and crop_size:
        try:
            await put_image_in_object_store(uuid, base64_file, crop_size)
        except:
            logger.exception('Storing image failed')
            return '', 500

    if uuid and base64_audio_file:
        try:
            await put_audio_in_object_store(
                uuid=uuid,
                audio_file_bytes=base64_audio_file.transcoded,
            )
        except:
            logger.exception('Storing audio failed')
            return '', 500

    return None
