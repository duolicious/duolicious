from serviceshared.database import Row, Tx, api_tx
from serviceshared.database._row import row_int_or_none
from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Tuple, Literal
from serviceshared.util.coerce import string
from service.api.person.urlslug import (
    assign_url_slug,
    reserve_onboardee_url_slug,
)
import service.api.duotypes as t
import json
import secrets
from service.api import sessioncache
from service.api.duohash import sha512
from PIL import Image
import io
import boto3
import asyncio
from serviceshared import asyncboto
from service.api.person.sql import *
from service.api.search.sql import Q_SET_SEARCH_PREFERENCE_CLUB
from service.api.searchfilters import TWO_WAY_FILTER_KEYS
from serviceshared.commonsql import *
from service.api.qanda import _flush_session_answers
from serviceshared.constants import VISITOR_ONLINE_TIMEOUT_SECONDS
from service.api.chat.chatutil import REDIS_WORKER_CLIENT
from service.api.chat.online import redis_publish_online
from service.api.person.visitornotification import notify_of_visit
from service.api.person.visitorspush import publish_visit
from service.api.person.template import otp_template
import logging
import re
from serviceshared.smtp import aws_smtp
from starlette.responses import Response
from starlette.concurrency import run_in_threadpool
from dataclasses import dataclass
import psycopg
from serviceshared.antiabuse.antispam.signupemail import (
    get_email_info,
    normalize_email,
)
from serviceshared.antiabuse.antirude import displayname, education, occupation
from serviceshared.antiabuse import bannedphoto
from serviceshared.antiabuse import anonymizers
import blurhash
import numpy
from service.api.async_lru_cache import AsyncLruCache
from datetime import datetime, timezone
from urllib.parse import quote
from service.api.duoaudio import put_audio_in_object_store
from service.api.person.duophoto import (
    CropSize,
    orient_image,
    photo_geometry,
    photo_geometry_params,
)
from service.api.person.aboutdiff import diff_addition_with_context
from service.api.auth.session import sign_out, enforce_session_limit
from service.api.auth.social import (
    SocialAuthError,
    verify_apple_identity_token,
    verify_google_id_token,
)
from serviceshared.verification.messages import (
    V_QUEUED,
    V_REUSED_SELFIE,
    V_UPLOADING_PHOTO,
)


from serviceshared.duoenv.api import ENV as DUO_ENV
from serviceshared.duoenv.shared import (
    BOTO_ENDPOINT_URL,
    R2_ACCESS_KEY_ID,
    R2_ACCESS_KEY_SECRET,
    R2_ACCT_ID,
    R2_BUCKET_NAME,
)

logger = logging.getLogger(__name__)

s3 = boto3.resource(
    's3',
    endpoint_url=BOTO_ENDPOINT_URL,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_ACCESS_KEY_SECRET,
)

bucket = s3.Bucket(R2_BUCKET_NAME)

def process_image_as_image(
    image: Image.Image,
    output_size: int | None = None,
    crop_size: CropSize | None = None,
) -> Image.Image:
    image = orient_image(image)

    if output_size is None:
        return image.convert('RGB')

    g = photo_geometry(*image.size, crop_size)

    min_dim = min(g.width, g.height)

    image = image.crop((
        g.crop_left,
        g.crop_top,
        g.crop_left + min_dim,
        g.crop_top + min_dim,
    ))

    if output_size != min_dim:
        image = image.resize((output_size, output_size))

    return image.convert('RGB')

def process_image_as_bytes(
    base64_file: t.Base64File,
    format: Literal['raw', 'jpeg'],
    output_size: int | None = None,
    crop_size: CropSize | None = None,
) -> io.BytesIO:
    if format == 'raw':
        return io.BytesIO(base64_file.bytes)

    output_bytes = io.BytesIO()

    image = process_image_as_image(base64_file.image, output_size, crop_size)

    image.save(
        output_bytes,
        format=format,
        quality=85,
        subsampling=2,
        progressive=True,
        optimize=True,
    )

    output_bytes.seek(0)

    return output_bytes

def compute_blurhash(image: Image.Image, crop_size: CropSize | None = None) -> object:
    image = process_image_as_image(image, output_size=32, crop_size=crop_size)

    return blurhash.encode(numpy.array(image.convert("RGB")))

async def put_image_in_object_store(
    uuid: str,
    base64_file: t.Base64File,
    crop_size: CropSize,
    sizes: list[Literal[None, 900, 450]] = [None, 900, 450],
) -> None:
    def process() -> list[tuple[str, io.BytesIO]]:
        key_img = [
            (
                f'{size if size else "original"}-{uuid}.jpg',
                process_image_as_bytes(
                    base64_file=base64_file,
                    format='jpeg',
                    output_size=size,
                    crop_size=None if size is None else crop_size
                )
            )
            for size in sizes
        ]

        if base64_file.image.format == 'GIF' and None in sizes:
            key_img.append((
                f'{uuid}.gif',
                process_image_as_bytes(base64_file=base64_file, format='raw')
            ))

        return key_img

    # Image processing is CPU-bound, so keep it off the event loop.
    key_img = await run_in_threadpool(process)

    await asyncio.gather(*[
        asyncboto.put_object(bucket, Key=key, Body=img)
        for key, img in key_img
    ])

async def _has_gold(person_id: int) -> bool:
    async with api_tx() as tx:
        row = await tx.require_one(Q_HAS_GOLD, dict(person_id=person_id))
    return row.get('has_gold', False)


async def _send_otp(email: str, otp: str) -> None:
    if email.endswith('@example.com'):
        return

    # smtp.send is blocking; keep it off the event loop.
    await run_in_threadpool(
        aws_smtp.send,
        subject="Sign in to Duolicious",
        body=otp_template(otp),
        to_addr=email,
        from_addr='noreply-otp@duolicious.app',
    )

@dataclass(frozen=True)
class _SignupGate:
    # An (error, status) response to return early with, or None to proceed.
    error: tuple[str, int] | None

    # ASNs to record on the new session; None when unknown or not a sign-up.
    asns: list[int] | None


async def _gate_signup(remote_addr: str | None, is_signup: bool) -> _SignupGate:
    """Best-effort, fail-open anonymizer gate (FireHOL lists plus the ASN
    blocklist) for sign-ups; sign-ins get only ban-based blocking
    (`Q_IS_BANNED`)."""
    if not is_signup:
        return _SignupGate(error=None, asns=None)

    if not remote_addr:
        return _SignupGate(error=('IP address blocked', 460), asns=None)

    result = await anonymizers.check(remote_addr)

    if result.blocked:
        return _SignupGate(error=('IP address blocked', 460), asns=result.asns)

    return _SignupGate(error=None, asns=result.asns)


async def _check_banned(tx: Tx, normalized_email: str, remote_addr: str | None) -> object:
    await tx.execute(Q_IS_BANNED, dict(
        normalized_email=normalized_email,
        ip_address=remote_addr,
    ))

    banned = await tx.fetchone()

    if banned:
        return 'Banned', 461

    return None

def _new_session_token() -> tuple[str, str]:
    session_token = secrets.token_hex(64)
    return session_token, sha512(session_token)

def _otp_from_rows(rows: Sequence[Mapping[str, object]]) -> str | None:
    try:
        row, *_ = rows
        otp = row['otp']
        if not isinstance(otp, str):
            return None
        return otp
    except:
        return None

async def _handle_pending_club(
    tx: Tx,
    person_id: int | None,
    pending_club_name: str | None,
) -> Mapping[str, object]:
    club_params = dict(
        person_id=person_id,
        club_name=pending_club_name,
        pending_club_name=pending_club_name,
        do_modify=True,
        update_event=False,
    )
    if person_id is not None and pending_club_name is not None:
        await tx.execute(Q_JOIN_CLUB, club_params)
        await tx.execute(Q_SET_SEARCH_PREFERENCE_CLUB, club_params)
        await tx.execute(
            Q_REFRESH_CLUB_VECTOR, dict(person_id=person_id))
    elif person_id is not None:
        await tx.execute(
            Q_REFRESH_STALE_CLUB_VECTOR, dict(person_id=person_id))
    return await tx.require_one(Q_GET_SESSION_CLUBS, club_params)


def _str_value(value: object, field_name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f'Field {field_name} must be a string')
    return value


async def post_request_otp(
    req: t.PostRequestOtp,
    remote_addr: str | None,
) -> object:
    normalized = normalize_email(req.email)

    email_info = await get_email_info(req.email, normalized)

    if not email_info.domain_ok:
        return 'Disposable email', 400

    gate = await _gate_signup(remote_addr, is_signup=not email_info.registered)
    if gate.error:
        return gate.error

    session_token, session_token_hash = _new_session_token()

    # Stash any answers the user gave before signing up on the session row, to
    # be flushed onto their profile once the session resolves to a person.
    answers = json.dumps([
        dict(question_id=a.question_id, answer=a.answer, public=a.public)
        for a in req.answers
    ]) if req.answers else None

    params = dict(
        email=req.email,
        normalized_email=normalized,
        pending_club_name=req.pending_club_name,
        is_dev=DUO_ENV == 'dev',
        session_token_hash=session_token_hash,
        ip_address=remote_addr,
        answers=answers,
        asns=gate.asns,
    )

    async with api_tx() as tx:
        if banned := await _check_banned(tx, normalized, remote_addr):
            return banned

        await tx.execute(Q_INSERT_DUO_SESSION, params)
        rows = await tx.fetchall()

    otp = _otp_from_rows(rows)
    if otp is None:
        # The ban path is handled above; reaching here means the OTP
        # CTE returned no rows for some other reason (e.g. the
        # `bad_email_domain` filter on a new sign-up). Surfacing
        # 'Banned' is a deliberate vagueness — we don't tell the
        # caller which guardrail tripped.
        return 'Banned', 461

    await _send_otp(req.email, otp)

    return dict(session_token=session_token)

async def post_resend_otp(
    s: t.SessionInfo,
    remote_addr: str | None,
) -> object:
    # A session without a person is an in-progress sign-up, so the gate from
    # `post_request_otp` still applies.
    gate = await _gate_signup(remote_addr, is_signup=s.person_id is None)
    if gate.error:
        return gate.error

    normalized = normalize_email(s.email)
    params = dict(
        email=s.email,
        normalized_email=normalized,
        is_dev=DUO_ENV == 'dev',
        session_token_hash=s.session_token_hash,
        ip_address=remote_addr,
    )

    async with api_tx() as tx:
        if banned := await _check_banned(tx, normalized, remote_addr):
            return banned

        await tx.execute(Q_UPDATE_OTP, params)
        rows = await tx.fetchall()

    otp = _otp_from_rows(rows)
    if otp is None:
        return 'Banned', 461

    await _send_otp(s.email, otp)
    return None

async def post_check_otp(
    req: t.PostCheckOtp,
    s: t.SessionInfo,
    remote_addr: str | None,
) -> object:
    gate = await _gate_signup(remote_addr, is_signup=s.person_id is None)
    if gate.error:
        return gate.error

    params = dict(
        otp=req.otp,
        session_token_hash=s.session_token_hash,
        pending_club_name=s.pending_club_name,
    )

    async with api_tx() as tx:
        await tx.execute(Q_MAYBE_DELETE_ONBOARDEE, params)
        await tx.execute(Q_MAYBE_SIGN_IN, params)
        row = await tx.fetchone()

        if not row:
            return 'Invalid OTP', 401

        clubs = await _handle_pending_club(
            tx, s.person_id, s.pending_club_name)

        await tx.execute(Q_UPDATE_LAST, dict(person_uuid=row['person_uuid']))

        if row['person_id'] is not None:
            await _flush_session_answers(
                tx, s.session_token_hash, row['person_id'])

    await sessioncache.delete_session(s.session_token_hash)

    await enforce_session_limit(row['person_id'], s.session_token_hash)

    return dict(
        onboarded=row['person_id'] is not None,
        **row,
        **clubs,
    )

async def post_sign_out(s: t.SessionInfo) -> None:
    await sign_out([s.session_token_hash])

async def _sign_in_with_social(
    provider: str,
    sub: str,
    email: str,
    email_verified: bool,
    pending_club_name: str | None,
    remote_addr: str | None,
) -> object:
    """
    Async counterpart to `_sign_in_with_social` for native FastAPI routes.
    """
    session_token, session_token_hash = _new_session_token()
    normalized = normalize_email(email)

    async with api_tx() as tx:
        if banned := await _check_banned(tx, normalized, remote_addr):
            return banned

        row_tx = await tx.execute(Q_LOOKUP_SOCIAL_IDENTITY, dict(
            provider=provider,
            provider_sub=sub,
        ))
        row: Row | None = await row_tx.fetchone()
        person_id: int | None = row['person_id'] if row else None

        needs_email_match = person_id is None and email

        if needs_email_match and not email_verified:
            existing_tx = await tx.execute(Q_LOOKUP_PERSON_BY_EMAIL, dict(
                normalized_email=normalized,
                email=email,
            ))
            existing: Row | None = await existing_tx.fetchone()
            return (
                'An account already exists for this email. Sign in '
                'with the email link to confirm ownership, then try '
                'social sign-in again.'
                if existing else
                'Your email address is not verified with the sign-in '
                'provider. Verify it and try again.',
                409,
            )

        email_match: Row | None = None
        if needs_email_match:
            email_match_tx = await tx.execute(Q_LOOKUP_PERSON_BY_EMAIL, dict(
                normalized_email=normalized,
                email=email,
            ))
            email_match = await email_match_tx.fetchone()

        if email_match:
            person_id = email_match['person_id']

        if person_id is None and not email:
            return 'Provider did not return an email', 400

    # The gate does external HTTP; never hold a transaction open across it. The
    # first transaction above is read-only, so all writes stay atomic in the
    # second one below.
    gate = await _gate_signup(remote_addr, is_signup=person_id is None)
    if gate.error:
        return gate.error

    async with api_tx() as tx:
        if email_match:
            await tx.execute(Q_INSERT_SOCIAL_IDENTITY, dict(
                provider=provider,
                provider_sub=sub,
                person_id=person_id,
                email=email,
            ))

        pending_provider = None
        pending_sub = None
        if person_id is None:
            await tx.execute(Q_UPSERT_ONBOARDEE_FOR_SOCIAL, dict(email=email))
            pending_provider = provider
            pending_sub = sub

        await tx.execute(Q_INSERT_DUO_SESSION_SOCIAL, dict(
            session_token_hash=session_token_hash,
            person_id=person_id,
            email=email,
            pending_club_name=pending_club_name,
            ip_address=remote_addr,
            pending_social_provider=pending_provider,
            pending_social_sub=pending_sub,
            asns=gate.asns,
        ))

        if person_id is not None:
            profile = await tx.require_one(Q_AFTER_SOCIAL_SIGN_IN, dict(
                person_id=person_id,
            ))
        else:
            profile = dict(
                person_id=None,
                person_uuid=None,
                has_gold=False,
                units=None,
                do_show_donation_nag=False,
                estimated_end_date=None,
                name=None,
            )

        clubs = await _handle_pending_club(
            tx, person_id, pending_club_name)

        if profile.get('person_uuid'):
            await tx.execute(Q_UPDATE_LAST, dict(person_uuid=profile['person_uuid']))

    await enforce_session_limit(person_id, session_token_hash)

    return dict(
        session_token=session_token,
        onboarded=person_id is not None,
        **profile,
        **clubs,
    )

async def post_sign_in_with_google(
    *,
    token: str,
    pending_club_name: str | None,
    remote_addr: str | None,
) -> object:
    try:
        claims = verify_google_id_token(token)
    except SocialAuthError as e:
        return f'Invalid Google token: {e}', 401

    return await _sign_in_with_social(
        provider='google',
        sub=claims.sub,
        email=claims.email,
        email_verified=claims.email_verified,
        pending_club_name=pending_club_name,
        remote_addr=remote_addr,
    )

async def post_sign_in_with_apple(
    *,
    token: str,
    nonce: str,
    pending_club_name: str | None,
    remote_addr: str | None,
) -> object:
    try:
        claims = verify_apple_identity_token(token, expected_nonce=nonce)
    except SocialAuthError as e:
        return f'Invalid Apple token: {e}', 401

    return await _sign_in_with_social(
        provider='apple',
        sub=claims.sub,
        email=claims.email,
        email_verified=claims.email_verified,
        pending_club_name=pending_club_name,
        remote_addr=remote_addr,
    )

async def post_check_session_token(s: t.SessionInfo) -> object:
    params = dict(
        person_id=s.person_id,
        pending_club_name=s.pending_club_name,
    )

    async with api_tx() as tx:
        row_tx = await tx.execute(Q_CHECK_SESSION_TOKEN, params)
        row = await row_tx.fetchone()

        if not row:
            return 'Invalid token', 401

        club_params = dict(
            person_id=s.person_id,
            pending_club_name=s.pending_club_name,
        )

        clubs = await tx.require_one(Q_GET_SESSION_CLUBS, club_params)

        return dict(
            person_id=s.person_id,
            person_uuid=s.person_uuid,
            onboarded=s.onboarded,
            **row,
            **clubs,
        )

# Rude-text checks that share the same shape (reject the field's value if the
# checker flags it). `base64_file` inspects a hash and has its own message, so
# it's handled separately in `_reject_rude_or_banned`.
_RUDE_TEXT_CHECKS: dict[str, Callable[[str], Awaitable[bool]]] = {
    'name': displayname.is_rude,
    'occupation': occupation.is_rude,
    'education': education.is_rude,
}


async def _reject_rude_or_banned(field_name: str, req: object) -> None:
    """Anti-abuse checks that need the async DB, so they run here rather than in
    the (synchronous) pydantic validators for these fields. Every handler
    accepting one of these fields must call this.

    A field can legitimately be set to null (e.g. clearing occupation), so the
    check is skipped when its value is None."""
    value = getattr(req, field_name, None)
    if value is None:
        return

    if field_name == 'base64_file':
        if await bannedphoto.is_banned_photo(value.md5_hash):
            raise t.FieldValidationError(
                'base64_file', 'That pic breaks the rules 🙈')
        return

    checker = _RUDE_TEXT_CHECKS.get(field_name)
    if checker is not None and await checker(value):
        raise t.FieldValidationError(field_name, 'Too rude')


async def patch_onboardee_info(req: t.PatchOnboardeeInfo, s: t.SessionInfo) -> object:
    [field_name] = req.__pydantic_fields_set__
    field_value = req.dict()[field_name]

    await _reject_rude_or_banned(field_name, req)

    if field_name == 'name':
        name = string(field_value)
        name_params = dict(
            email=s.email,
            field_value=name,
        )

        q_set_onboardee_field = """
            INSERT INTO onboardee (
                email,
                name
            ) VALUES (
                %(email)s,
                %(field_value)s
            ) ON CONFLICT (email) DO UPDATE SET
                name = EXCLUDED.name
            """

        async with api_tx() as tx:
            await tx.execute(q_set_onboardee_field, name_params)
            return await reserve_onboardee_url_slug(tx, s.email, name)
    elif field_name == 'date_of_birth':
        params = dict(
            email=s.email,
            field_value=field_value
        )

        q_set_onboardee_field = """
            INSERT INTO onboardee (
                email,
                date_of_birth
            ) VALUES (
                %(email)s,
                %(field_value)s
            ) ON CONFLICT (email) DO UPDATE SET
                date_of_birth = EXCLUDED.date_of_birth
            """

        async with api_tx() as tx:
            await tx.execute(q_set_onboardee_field, params)
    elif field_name == 'location':
        params = dict(
            email=s.email,
            long_friendly=field_value
        )

        q_set_onboardee_field = """
            INSERT INTO onboardee (
                email,
                coordinates
            ) SELECT
                %(email)s,
                coordinates
            FROM location
            WHERE long_friendly = %(long_friendly)s
            ON CONFLICT (email) DO UPDATE SET
                coordinates = EXCLUDED.coordinates
            """
        async with api_tx() as tx:
            await tx.execute(q_set_onboardee_field, params)
            if tx.rowcount != 1:
                return 'Unknown location', 400
    elif field_name == 'gender':
        params = dict(
            email=s.email,
            gender=field_value
        )

        q_set_onboardee_field = """
            INSERT INTO onboardee (
                email,
                gender_id
            ) SELECT
                %(email)s,
                id
            FROM gender
            WHERE name = %(gender)s
            ON CONFLICT (email) DO UPDATE SET
                gender_id = EXCLUDED.gender_id
            """

        async with api_tx() as tx:
            await tx.execute(q_set_onboardee_field, params)
    elif field_name == 'other_peoples_genders':
        params = dict(
            email=s.email,
            genders=field_value
        )

        q_set_onboardee_field = """
            INSERT INTO onboardee_search_preference_gender (
                email,
                gender_id
            )
            SELECT
                %(email)s,
                id
            FROM gender
            WHERE name = ANY(%(genders)s)
            ON CONFLICT (email, gender_id) DO UPDATE SET
                gender_id = EXCLUDED.gender_id
            """

        async with api_tx() as tx:
            await tx.execute(q_set_onboardee_field, params)
    else:
        return f'Invalid field name {field_name}', 400

    return None

async def post_finish_onboarding(s: t.SessionInfo) -> object:
    api_params = dict(
        email=s.email,
        normalized_email=normalize_email(s.email),
        pending_club_name=s.pending_club_name,
    )

    async with api_tx() as tx:
        await tx.execute('SET LOCAL statement_timeout = 15000') # 15 seconds
        row = await tx.require_one(Q_FINISH_ONBOARDING, params=api_params)

        # If this user signed up via Google/Apple, drain the pending
        # provider identity from `duo_session` into `social_identity` now
        # that the new `person` row exists.
        await tx.execute(Q_PROMOTE_PENDING_SOCIAL_IDENTITY, dict(
            session_token_hash=s.session_token_hash,
            person_id=row['person_id'],
        ))

        clubs = await _handle_pending_club(
            tx,
            row['person_id'],
            s.pending_club_name,
        )

        await _flush_session_answers(
            tx,
            s.session_token_hash,
            row['person_id'],
        )

    await sessioncache.delete_session(s.session_token_hash)

    return dict(**row, **clubs)

async def get_prospect_profile(
    s: t.SessionInfo | None,
    prospect_handle: object,
) -> object:
    params = dict(
        person_id=s.person_id if s is not None else None,
        prospect_handle=prospect_handle,
    )

    async with api_tx('READ COMMITTED') as tx:
        row_tx = await tx.execute(Q_SELECT_PROSPECT_PROFILE, params)
        api_row = await row_tx.fetchone()
        if not api_row:
            return '', 404

        profile = api_row.get('j')
        if not isinstance(profile, dict) or not profile:
            return '', 404

        # The handle may have been a url_slug; resolve to the real uuid so the
        # message-stats query (which keys on person.uuid) gets a valid value.
        prospect_uuid = api_row.get('prospect_uuid')
        prospect_id = api_row.get('prospect_id')

    if s is None:
        # Reply-rate stats count replies *to* %(person_id)s, so they're
        # meaningless for anonymous viewers - return NULL rather than 0%.
        profile.update(dict(
            gets_reply_percentage=None,
            gives_reply_percentage=None,
        ))
        return profile

    # Timeout in case someone with lots of messages hogs CPU time
    try:
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute('SET LOCAL statement_timeout = 1000') # 1 second
            message_stats: Mapping[str, object] = await tx.require_one(
                Q_MESSAGE_STATS,
                dict(prospect_uuid=prospect_uuid),
            )
    except psycopg.errors.QueryCanceled:
        message_stats = dict(
            gets_reply_percentage=None,
            gives_reply_percentage=None,
        )

    profile.update(message_stats)

    if s.person_id is not None and s.person_uuid is not None and \
            prospect_id is not None and prospect_uuid is not None:
        seconds_since_last_online = profile.get('seconds_since_last_online')
        prospect_online = (
            isinstance(seconds_since_last_online, (int, float)) and
            seconds_since_last_online < VISITOR_ONLINE_TIMEOUT_SECONDS
        )

        await publish_visit(
            viewer_id=s.person_id,
            viewer_uuid=s.person_uuid,
            prospect_id=prospect_id,
            prospect_uuid=str(prospect_uuid),
            prospect_online=prospect_online,
        )

        await notify_of_visit(
            viewer_id=s.person_id,
            prospect_id=prospect_id,
            prospect_uuid=str(prospect_uuid),
            prospect_online=prospect_online,
        )

    return profile

async def get_conversation_prospect(s: t.SessionInfo, prospect_uuid: str) -> object:
    params = dict(
        person_id=s.person_id,
        prospect_uuid=prospect_uuid,
    )

    async with api_tx('READ COMMITTED') as tx:
        api_row = await (
            await tx.execute(Q_SELECT_CONVERSATION_PROSPECT, params)
        ).fetchone()
        if not api_row:
            return '', 404

        profile = api_row.get('j')
        if not profile:
            return '', 404

        return profile

async def post_unskip_by_uuid(s: t.SessionInfo, prospect_uuid: str) -> None:
    params = dict(
        subject_person_id=s.person_id,
        prospect_uuid=prospect_uuid,
    )

    async with api_tx() as tx:
        await tx.execute(Q_DELETE_SKIPPED_BY_UUID, params)

async def get_compare_personalities(
    s: t.SessionInfo,
    prospect_person_id: int,
    topic: str
) -> object:
    url_topic_to_db_topic = {
        'mbti': 'MBTI',
        'big5': 'Big 5',
        'attachment': 'Attachment Style',
        'politics': 'Politics',
        'other': 'Other',
    }

    if topic not in url_topic_to_db_topic:
        return 'Topic not found', 404

    db_topic = url_topic_to_db_topic[topic]

    params = dict(
        person_id_as_int=s.person_id,
        person_id_as_str=None,
        prospect_person_id=prospect_person_id,
        topic=db_topic,
    )

    async with api_tx('READ COMMITTED') as tx:
        row_tx = await tx.execute(Q_SELECT_PERSONALITY, params)
        return await row_tx.fetchall()

async def get_compare_answers(
    s: t.SessionInfo,
    prospect_person_id: int,
    agreement: str | None,
    topic: str | None,
    n: str | None,
    o: str | None,
) -> object:
    valid_agreements = ['all', 'agree', 'disagree', 'unanswered']
    valid_topics = ['all', 'values', 'sex', 'interpersonal', 'other']

    if agreement not in valid_agreements:
        return 'Invalid agreement', 400

    if topic not in valid_topics:
        return 'Invalid topic', 400

    if n is None:
        return 'Invalid n', 400
    try:
        int(n)
    except:
        return 'Invalid n', 400

    if o is None:
        return 'Invalid o', 400
    try:
        int(o)
    except:
        return 'Invalid o', 400

    params = dict(
        person_id=s.person_id,
        prospect_person_id=prospect_person_id,
        agreement=agreement.capitalize(),
        topic=topic.capitalize(),
        n=n,
        o=o,
    )

    async with api_tx('READ COMMITTED') as tx:
        row_tx = await tx.execute(Q_ANSWER_COMPARISON, params)
        return await row_tx.fetchall()

async def delete_or_ban_account(
    s: t.SessionInfo | None,
    admin_ban_token: str | None = None,
) -> object:
    async with api_tx() as tx:
        await tx.execute('SET LOCAL statement_timeout = 30_000')  # 30 seconds

        if admin_ban_token:
            row_tx = await tx.execute(
                Q_ADMIN_BAN,
                params=dict(token=admin_ban_token)
            )
            rows = await row_tx.fetchall()
        elif s:
            rows = [
                dict(
                    person_id=s.person_id,
                    person_uuid=s.person_uuid
                )
            ]
        else:
            raise ValueError('At least one parameter must not be None')

        person_ids = [r['person_id'] for r in rows if r['person_id'] is not None]
        if person_ids:
            row_tx = await tx.execute(
                Q_SELECT_SESSION_TOKEN_HASHES_BY_PERSON_ID,
                params=dict(person_ids=person_ids),
            )
            session_token_rows = await row_tx.fetchall()
            session_token_hashes = [
                r['session_token_hash']
                for r in session_token_rows
            ]
        else:
            session_token_hashes = []

        await tx.executemany(Q_DELETE_ACCOUNT, params_seq=rows)

    await sign_out(session_token_hashes)

    return rows

async def post_deactivate(s: t.SessionInfo) -> None:
    params = dict(person_id=s.person_id)

    async with api_tx() as tx:
        row_tx = await tx.execute(Q_POST_DEACTIVATE, params)
        rows = await row_tx.fetchall()

    for row in rows:
        await sessioncache.delete_session(row['session_token_hash'])

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

    await _reject_rude_or_banned(field_name, req)
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

async def get_search_filters(s: t.SessionInfo) -> object:
    return await get_search_filters_by_person_id(person_id=s.person_id)

async def get_search_filters_by_person_id(
    person_id: int | None,
) -> object:
    params = dict(person_id=person_id)

    async with api_tx('READ COMMITTED') as tx:
        return (await tx.require_one(Q_GET_SEARCH_FILTERS, params))['j']

_ENUM_SEARCH_FILTER_FIELDS = {
    'gender':                ('gender_ids',              'gender'),
    'orientation':           ('orientation_ids',         'orientation'),
    'ethnicity':             ('ethnicity_ids',           'ethnicity'),
    'has_a_profile_picture': ('has_profile_picture_ids', 'yes_no'),
    'looking_for':           ('looking_for_ids',         'looking_for'),
    'smoking':               ('smoking_ids',             'yes_no_optional'),
    'drinking':              ('drinking_ids',            'frequency'),
    'drugs':                 ('drugs_ids',               'yes_no_optional'),
    'long_distance':         ('long_distance_ids',       'yes_no_optional'),
    'relationship_status':   ('relationship_status_ids', 'relationship_status'),
    'has_kids':              ('has_kids_ids',            'yes_no_optional'),
    'wants_kids':            ('wants_kids_ids',          'yes_no_maybe'),
    'exercise':              ('exercise_ids',            'frequency'),
    'religion':              ('religion_ids',            'religion'),
    'star_sign':             ('star_sign_ids',           'star_sign'),
}


async def post_search_filter(req: t.PostSearchFilter, s: t.SessionInfo) -> object:
    [field_name] = req.__pydantic_fields_set__
    field_value = req.dict()[field_name]

    # Modify `field_value` for certain `field_name`s
    if field_name in ['age', 'height', 'two_way_filters']:
        field_value = json.dumps(field_value)

    params = dict(
        person_id=s.person_id,
        field_value=field_value,
    )

    if field_name in _ENUM_SEARCH_FILTER_FIELDS:
        column, lookup = _ENUM_SEARCH_FILTER_FIELDS[field_name]
        params['expected_count'] = len(set(field_value))

        q = f"""
        UPDATE search_preference SET {column} = t.ids
        FROM (
            SELECT
                COALESCE(array_agg(id ORDER BY id), ARRAY[]::SMALLINT[]) AS ids,
                count(*) AS n
            FROM {lookup}
            WHERE name = ANY(%(field_value)s)
        ) AS t
        WHERE person_id = %(person_id)s
        AND t.n = %(expected_count)s
        """
    elif field_name == 'age':
        q = """
        UPDATE search_preference SET
            min_age = (json_data->>'min_age')::SMALLINT,
            max_age = (json_data->>'max_age')::SMALLINT
        FROM to_json(%(field_value)s::json) AS json_data
        WHERE person_id = %(person_id)s
        """
    elif field_name == 'height':
        q = """
        UPDATE search_preference SET
            min_height_cm = (json_data->>'min_height_cm')::SMALLINT,
            max_height_cm = (json_data->>'max_height_cm')::SMALLINT
        FROM to_json(%(field_value)s::json) AS json_data
        WHERE person_id = %(person_id)s
        """
    elif field_name == 'furthest_distance':
        q = """
        UPDATE search_preference SET distance = %(field_value)s
        WHERE person_id = %(person_id)s
        """
    elif field_name == 'last_online':
        q = """
        UPDATE search_preference SET last_online_id = last_online.id
        FROM last_online
        WHERE last_online.name = %(field_value)s
        AND person_id = %(person_id)s
        """
    elif field_name == 'sort_by':
        q = """
        UPDATE search_preference SET sort_by_id = sort_by.id
        FROM sort_by
        WHERE sort_by.name = %(field_value)s
        AND person_id = %(person_id)s
        """
    elif field_name == 'people_you_messaged':
        q = """
        UPDATE search_preference SET show_messaged = yes_no.name = 'Yes'
        FROM yes_no
        WHERE yes_no.name = %(field_value)s
        AND person_id = %(person_id)s
        """
    elif field_name == 'people_you_skipped':
        q = """
        UPDATE search_preference SET show_skipped = yes_no.name = 'Yes'
        FROM yes_no
        WHERE yes_no.name = %(field_value)s
        AND person_id = %(person_id)s
        """
    elif field_name == 'two_way_filters':
        two_way_updates = ',\n'.join(
            f"            two_way_{key} = "
            f"COALESCE((json_data->>'{key}')::BOOLEAN, two_way_{key})"
            for key in TWO_WAY_FILTER_KEYS
        )

        q = f"""
        UPDATE search_preference SET
{two_way_updates}
        FROM to_json(%(field_value)s::json) AS json_data
        WHERE person_id = %(person_id)s
        """
    else:
        return f'Invalid field name {field_name}', 400

    async with api_tx() as tx:
        await tx.execute(q, params)

        if tx.rowcount != 1:
            return f'Invalid value for {field_name}', 400

    return None

async def post_search_filter_answer(
    req: t.PostSearchFilterAnswer,
    s: t.SessionInfo,
) -> object:
    max_search_filter_answers = 20
    error = f'You can’t set more than {max_search_filter_answers} Q&A filters'

    params = dict(
        person_id=s.person_id,
        question_id=req.question_id,
        answer=req.answer,
        accept_unanswered=req.accept_unanswered,
    )

    if req.answer is None:
        q = f"""
        WITH deleted_answer AS (
            DELETE FROM search_preference_answer
            WHERE
                person_id = %(person_id)s AND
                question_id = %(question_id)s
            RETURNING *
        )
        SELECT COALESCE(
            array_agg(
                json_build_object(
                    'question_id', question_id,
                    'question', question,
                    'topic', topic,
                    'answer', answer,
                    'accept_unanswered', accept_unanswered
                )
                ORDER BY question_id
            ),
            ARRAY[]::JSON[]
        ) AS j
        FROM search_preference_answer
        LEFT JOIN question
        ON question.id = question_id
        WHERE
            person_id = %(person_id)s AND
            question_id != (SELECT question_id FROM deleted_answer)
        """
    else:
        q = f"""
        WITH existing_search_preference_answer AS (
            SELECT
                person_id,
                question_id,
                answer,
                accept_unanswered,
                0 AS precedence
            FROM search_preference_answer
            WHERE person_id = %(person_id)s
        ), new_search_preference_answer AS (
            SELECT
                %(person_id)s AS person_id,
                %(question_id)s AS question_id,
                %(answer)s AS answer,
                %(accept_unanswered)s AS accept_unanswered,
                1 AS precedence
        ), updated_search_preference_answer AS (
            SELECT DISTINCT ON (person_id, question_id)
                person_id,
                question_id,
                answer,
                accept_unanswered
            FROM (
                (SELECT * from existing_search_preference_answer)
                UNION
                (SELECT * from new_search_preference_answer)
            ) AS t
            ORDER BY person_id, question_id, precedence DESC
        ), inserted_search_preference_answer AS (
            INSERT INTO search_preference_answer (
                person_id, question_id, answer, accept_unanswered
            ) SELECT
                person_id, question_id, answer, accept_unanswered
            FROM
                new_search_preference_answer
            WHERE (
                SELECT COUNT(*) FROM updated_search_preference_answer
            ) <= {max_search_filter_answers}
            ON CONFLICT (person_id, question_id) DO UPDATE SET
                answer            = EXCLUDED.answer,
                accept_unanswered = EXCLUDED.accept_unanswered
        )
        SELECT array_agg(
            json_build_object(
                'question_id', question_id,
                'question', question,
                'topic', topic,
                'answer', answer,
                'accept_unanswered', accept_unanswered
            )
            ORDER BY question_id
        ) AS j
        FROM updated_search_preference_answer
        LEFT JOIN question
        ON question.id = question_id
        WHERE (
            SELECT COUNT(*) FROM updated_search_preference_answer
        ) <= {max_search_filter_answers}
        """

    async with api_tx() as tx:
        answer = (await tx.require_one(q, params)).get('j')
        if answer is None:
            return dict(error=error), 400
        else:
            return dict(answer=answer)

async def get_search_clubs(
        s: t.SessionInfo | None,
        search_str: str,
        allow_empty: bool = False) -> object:

    if (search_str or '').strip():
        # A non-empty search string must be a valid club name.
        search_string = t.parse_club_name(search_str)
        if search_string is None:
            return []
    elif allow_empty:
        # Empty string is allowed and yields the most popular clubs.
        search_string = ''
    else:
        return []

    params = dict(
        person_id=s.person_id if s else None,
        search_string=search_string,
    )

    q = Q_SEARCH_CLUBS if search_string else Q_TOP_CLUBS

    async with api_tx('READ COMMITTED') as tx:
        row_tx = await tx.execute(q, params)
        return await row_tx.fetchall()

async def post_join_club(req: t.PostJoinClub, s: t.SessionInfo) -> object:
    params = dict(
        person_id=s.person_id,
        club_name=req.name,
        update_event=True,
    )

    async with api_tx('READ COMMITTED') as tx:
        row_tx = await tx.execute(Q_JOIN_CLUB, params)
        rows = await row_tx.fetchall()
        await tx.execute(
            Q_REFRESH_CLUB_VECTOR, dict(person_id=s.person_id))

    if rows:
        return f"Joined {req.name}", 200
    else:
        return f"Couldn't join {req.name}", 400

async def post_leave_club(req: t.PostLeaveClub, s: t.SessionInfo) -> None:
    params = dict(
        person_id=s.person_id,
        club_name=req.name,
    )

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_LEAVE_CLUB, params)
        await tx.execute(
            Q_REFRESH_CLUB_VECTOR, dict(person_id=s.person_id))

async def get_update_notifications(
    email: str,
    type: str,
    frequency: str,
) -> object:
    params = dict(
        email=email,
        frequency=frequency,
    )

    if type == 'Intros':
        queries = [Q_UPDATE_INTROS_NOTIFICATIONS]
    elif type == 'Chats':
        queries = [Q_UPDATE_CHATS_NOTIFICATIONS]
    elif type == 'Visitors':
        queries = [Q_UPDATE_VISITORS_NOTIFICATIONS]
    elif type == 'Every':
        queries = [
            Q_UPDATE_INTROS_NOTIFICATIONS,
            Q_UPDATE_CHATS_NOTIFICATIONS,
            Q_UPDATE_VISITORS_NOTIFICATIONS,
        ]
    else:
        return 'Invalid type', 400

    async with api_tx('READ COMMITTED') as tx:
        query_results = []
        for q in queries:
            query_results.append((await tx.require_one(q, params))['ok'])

    if all(query_results):
        return (
            f"✅ "
            f"<b>{type}</b> notification frequency set to "
            f"<b>{frequency}</b> for "
            f"<b>{email}</b>")
    else:
        return 'Invalid email address or notification frequency', 400

async def post_verification_selfie(
    req: t.PostVerificationSelfie,
    s: t.SessionInfo,
) -> object:
    await _reject_rude_or_banned('base64_file', req)

    base64 = req.base64_file.base64
    image = req.base64_file.image
    top = req.base64_file.top
    left = req.base64_file.left
    hash = req.base64_file.md5_hash

    crop_size = CropSize(top=top, left=left)
    photo_uuid = secrets.token_hex(32)

    params_ok = dict(
        person_id=s.person_id,
        photo_uuid=photo_uuid,
        photo_hash=hash,
        expected_previous_status=None,
    )

    params_bad = dict(
        person_id=s.person_id,
        status='failure',
        message=V_REUSED_SELFIE,
        expected_previous_status=None,
    )

    async with api_tx() as tx:
        row_tx = await tx.execute(Q_INSERT_VERIFICATION_PHOTO_HASH, params_ok)
        if await row_tx.fetchall():
            await tx.execute(Q_DELETE_VERIFICATION_JOB, params_ok)
            await tx.execute(Q_INSERT_VERIFICATION_JOB, params_ok)
        else:
            await tx.execute(Q_UPDATE_VERIFICATION_JOB, params_bad)

    try:
        await put_image_in_object_store(
            photo_uuid, req.base64_file, crop_size, sizes=[450])
    except Exception:
        logger.exception('Upload failed')
        return '', 500

    return None

async def post_verify(s: t.SessionInfo) -> None:
    params = dict(
        person_id=s.person_id,
        status='queued',
        message=V_QUEUED,
        expected_previous_status='uploading-photo',
    )

    async with api_tx() as tx:
        await tx.execute(Q_UPDATE_VERIFICATION_JOB, params)

async def get_check_verification(s: t.SessionInfo) -> object:
    async with api_tx() as tx:
        await tx.execute(Q_CHECK_VERIFICATION, dict(person_id=s.person_id))
        row = await tx.fetchone()

    if row:
        return row
    return '', 400

@AsyncLruCache(maxsize=2048)
async def get_club(name: str, ttl_hash: object = None) -> object:
    club_name = t.parse_club_name(name)
    if club_name is None:
        return None

    async with api_tx('READ COMMITTED') as tx:
        row_tx = await tx.execute(Q_CLUB_PAGE_READ, dict(club_name=club_name))
        row = await row_tx.fetchone()

    if not row:
        return None

    return {
        **row['stats_json'],
        'description':   row['description'],
        'top_answers':   row['top_answers'],
        'related_clubs': row['related_clubs'],
    }

@AsyncLruCache()
async def get_stats(
    ttl_hash: object = None,
    club_name: str | None = None,
) -> object:
    if club_name:
        q, params = Q_STATS_BY_CLUB_NAME, dict(club_name=club_name)
    else:
        q, params = Q_STATS, None

    async with api_tx('READ COMMITTED') as tx:
        row_tx = await tx.execute(q, params)
        return await row_tx.fetchone()

@AsyncLruCache()
async def get_gender_stats(ttl_hash: object = None) -> object:
    async with api_tx('READ COMMITTED') as tx:
        row_tx = await tx.execute(Q_GENDER_STATS)
        return await row_tx.fetchone()

async def get_admin_ban_link(token: str) -> object:
    params = dict(token=token)

    err_invalid_token = (
        'Invalid token. User might have already been banned', 401)

    try:
        async with api_tx() as tx:
            row_tx = await tx.execute(
                Q_ADMIN_TOKEN_TO_UUID,
                params,
            )
            row = await row_tx.fetchone()
            if row is None:
                raise TypeError()
            person_uuid = row['person_uuid']
    except TypeError:
        return err_invalid_token

    try:
        async with api_tx('READ COMMITTED') as tx:
            row_tx = await tx.execute(Q_CHECK_ADMIN_BAN_TOKEN, params)
            rows = await row_tx.fetchall()
    except psycopg.errors.InvalidTextRepresentation:
        return err_invalid_token

    if rows:
        link = f'https://api.duolicious.app/admin/ban/{token}'
        return f'<a href="{link}">Click to confirm. Token: {token}</a>'
    else:
        return err_invalid_token

async def get_admin_ban(token: str) -> object:
    rows = await delete_or_ban_account(s=None, admin_ban_token=token)

    if rows:
        return f'Banned {rows}'
    else:
        return 'Ban failed; User already banned or token invalid', 401

async def get_admin_delete_photo_link(token: str) -> object:
    params = dict(token=token)

    try:
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(Q_CHECK_ADMIN_DELETE_PHOTO_TOKEN, params)
            rows = await tx.fetchall()
    except psycopg.errors.InvalidTextRepresentation:
        return 'Invalid token', 401

    if rows:
        link = f'https://api.duolicious.app/admin/delete-photo/{token}'
        return f'<a href="{link}">Click to confirm. Token {token}</a>'
    else:
        return 'Invalid token', 401

async def get_admin_delete_photo(token: str) -> object:
    params = dict(token=token)

    async with api_tx('READ COMMITTED') as tx:
        row_tx = await tx.execute(Q_ADMIN_DELETE_PHOTO, params)
        rows = await row_tx.fetchall()

        if rows:
            params = dict(person_id=rows[0]['person_id'])
            await tx.execute(Q_UPDATE_VERIFICATION_LEVEL, params)

    if rows:
        return f'Deleted photo {rows}'
    else:
        return 'Photo deletion failed', 401

async def get_export_data_token(s: t.SessionInfo) -> object:
    params = dict(person_id=s.person_id)

    async with api_tx() as tx:
        row_tx = await tx.execute(Q_INSERT_EXPORT_DATA_TOKEN, params)
        return await row_tx.fetchone()

async def get_export_data(token: str) -> object:
    token_params = dict(token=token)

    # Fetch data from database
    async with api_tx('read committed') as tx:
        row_tx = await tx.execute(Q_CHECK_EXPORT_DATA_TOKEN, token_params)
        params = await row_tx.fetchone()

    if not params:
        return 'Invalid token. Link might have expired.', 401

    async with api_tx('read committed') as tx:
        await tx.execute('SET LOCAL statement_timeout = 30000') # 30 seconds
        raw_data = (await tx.require_one(Q_EXPORT_API_DATA, params))['j']

    person_id = row_int_or_none(params, 'person_id')

    search_filters = await get_search_filters_by_person_id(
        person_id=person_id,
    )

    # Redact sensitive fields
    for person in raw_data['person']:
        del person['id_salt']

    # Add a human-readable timestamp derived from the message id. The message
    # text itself is exported verbatim via the `body` column.
    for row in raw_data['mam_message'] or []:
        row['timestamp'] = datetime.fromtimestamp(
            timestamp=(row['id'] >> 8) / 1_000_000,
            tz=timezone.utc,
        ).isoformat()

    # Return the result
    exported_dict = dict(
        raw_data=raw_data,
        search_filters=search_filters,
    )

    exported_string = json.dumps(exported_dict, indent=2)

    exported_bytes = exported_string.encode()

    return Response(
        content=exported_bytes,
        media_type='text/json',
        headers={
            'Content-Disposition': 'attachment; filename="export.json"',
        },
    )

async def post_revenuecat(req: t.PostRevenuecat, auth_header: str) -> object:
    def get_has_gold() -> Tuple[list[str], list[str]]:
        match req.event:
            case t.InitialPurchaseEvent(app_user_id=app_user_id):
                return [], [app_user_id]
            case t.RenewalEvent(app_user_id=app_user_id):
                return [], [app_user_id]
            case t.ExpirationEvent(app_user_id=app_user_id):
                return [app_user_id], []
            case t.TransferEvent(
                    transferred_to=transferred_to,
                    transferred_from=transferred_from):
                return transferred_from, transferred_to

        return [], []


    def get_has_gold_params_seq() -> list[dict[str, object]]:
        has_no_gold_uuids, has_gold_uuids = get_has_gold()

        has_no_gold_params_seq = [
            dict(
                person_uuid=person_uuid,
                has_gold=False,
            )
            for person_uuid in has_no_gold_uuids
        ]

        has_gold_params_seq = [
            dict(
                person_uuid=person_uuid,
                has_gold=True
            )
            for person_uuid in has_gold_uuids
        ]

        return (
            has_no_gold_params_seq +
            has_gold_params_seq)


    try:
        bearer, revenuecat_token = auth_header.split()
        if bearer.lower() != 'bearer':
            raise Exception()
    except:
        return 'Missing or malformed authorization header', 400

    has_gold_params_seq = get_has_gold_params_seq()

    async with api_tx() as tx:
        await tx.execute(
            Q_SELECT_REVENUECAT_AUTHORIZED,
            dict(token_hash_revenuecat=sha512(revenuecat_token)),
        )
        if not await tx.fetchone():
            return 'Unauthorized', 401

        if not has_gold_params_seq:
            return 'Payload ignored because of its format', 200

        updated_rows = []
        for params in has_gold_params_seq:
            row_tx = await tx.execute(Q_UPDATE_GOLD_FROM_REVENUECAT, params)
            updated_rows.extend(await row_tx.fetchall())

        all_uuids = set(str(x['person_uuid']) for x in has_gold_params_seq)
        updated_uuids = set(str(x['person_uuid']) for x in updated_rows)
        ignored_uuids = all_uuids - updated_uuids

        return dict(
            all_uuids=sorted(all_uuids),
            updated_uuids=sorted(updated_uuids),
            ignored_uuids=sorted(ignored_uuids),
        )
