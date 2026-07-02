from pathlib import Path
from typing import Optional, cast
from urllib.parse import parse_qsl
from fastapi import Body, Depends, Path as FastApiPath
from starlette.requests import Request
from starlette.concurrency import run_in_threadpool
import duotypes as t
from antiabuse.lodgereport import skip_by_uuid
import location
import person
import qanda
from qanda import question
import search
from auth import apple_oauth
from database import api_tx
import psycopg
from service.api.decorators import (
    app,
    auth_rate_limit,
    client_ip,
    default_rate_limit,
    default_limits,
    session,
    rate_limit,
    limiter,
    shared_otp_limit_dependency,
    disable_ip_rate_limit,
    disable_account_rate_limit,
    limiter_account,
)
import time
from antiabuse.antispam.signupemail import normalize_email
import json

_init_sql_file = (
    Path(__file__).parent.parent.parent / 'init-api.sql')

_migrations_sql_file = (
    Path(__file__).parent.parent.parent / 'migrations.sql')

_email_domains_bad_file = (
    Path(__file__).parent.parent.parent / 'email-domains-bad.sql')

_email_domains_good_file = (
    Path(__file__).parent.parent.parent / 'email-domains-good.sql')

_banned_club_file = (
    Path(__file__).parent.parent.parent / 'banned-club.sql')

def get_ttl_hash(seconds: int = 10) -> int:
    """Return the same value withing `seconds` time period"""
    return round(time.time() / seconds)

async def migrate_unnormalized_emails() -> None:
    """
    It'll probably be necessary to call this function again if/when
    `normalize_email` normalizes more address.
    """
    async with api_tx() as tx:
        q = "SELECT 1 FROM person WHERE normalized_email ILIKE '%@googlemail.com' LIMIT 1"
        await tx.execute(q)
        if await tx.fetchone():
            print('Unnormalized emails found. Normalizing...')
        else:
            print('Emails already normalized. Not performing normalization.')
            return

    async with api_tx() as tx:
        print('Selecting emails')
        q = "SELECT email FROM person"
        await tx.execute('SET LOCAL statement_timeout = 300000') # 5 minutes
        await tx.execute(q)
        rows = await tx.fetchall()
        print('Done selecting emails')

    print('Computing normalized emails')
    params_seq = [
        row | dict(normalized_email=normalize_email(row['email']))
        for row in rows
    ]
    print('Done computing normalized emails')

    async with api_tx('read committed') as tx:
        q = """
        UPDATE person SET
        normalized_email = %(normalized_email)s
        WHERE email = %(email)s
        """
        print('Updating normalized emails in `person` table')
        await tx.execute('SET LOCAL statement_timeout = 300000') # 5 minutes
        await tx.executemany(q, params_seq)
        print('Done updating normalized emails in `person` table')

        q = """
        UPDATE banned_person bp
        SET
            normalized_email = %(normalized_email)s
        WHERE
            normalized_email = %(email)s
        AND NOT EXISTS (
            SELECT
                1
            FROM
                banned_person
            WHERE
                normalized_email = %(normalized_email)s
            AND
                ip_address = bp.ip_address
        )
        """
        print('Updating normalized emails in `banned_person` table')
        await tx.executemany(q, params_seq)
        print('Done updating normalized emails in `banned_person` table')

async def maybe_run_init() -> None:
    async with api_tx() as tx:
        row = await tx.require_one("SELECT to_regclass('person')")

    if row ['to_regclass'] is not None:
        print('Database already initialized')
        return

    with open(_init_sql_file, 'r') as f:
        init_sql_file = f.read()

    async with api_tx() as tx:
        await tx.execute(init_sql_file)

async def init_db() -> None:
    with open(_migrations_sql_file, 'r') as f:
        migrations_sql_file = f.read()

    with open(_email_domains_bad_file, 'r') as f:
        email_domains_bad_file = f.read()

    with open(_email_domains_good_file, 'r') as f:
        email_domains_good_file = f.read()

    with open(_banned_club_file, 'r') as f:
        banned_club_file = f.read()

    await maybe_run_init()

    async with api_tx() as tx:
        await tx.execute('SET LOCAL statement_timeout = 300000') # 5 minutes
        await tx.execute(migrations_sql_file)

    async with api_tx() as tx:
        await tx.execute(email_domains_bad_file)

    async with api_tx() as tx:
        await tx.execute(email_domains_good_file)

    async with api_tx() as tx:
        await tx.execute('SET LOCAL statement_timeout = 300000') # 5 minutes
        await tx.execute(banned_club_file)

    await migrate_unnormalized_emails()

@app.post('/request-otp')
async def post_request_otp(
    request: Request,
    req: t.PostRequestOtp,
    _default_limited: None = Depends(default_rate_limit()),
    _shared_limited: None = Depends(shared_otp_limit_dependency),
) -> object:
    return await person.post_request_otp(req, client_ip(request))

@app.post('/resend-otp')
async def post_resend_otp(
    request: Request,
    _default_limited: None = Depends(default_rate_limit()),
    _shared_limited: None = Depends(shared_otp_limit_dependency),
    s: t.SessionInfo = Depends(session(
        expected_onboarding_status=None,
        expected_sign_in_status=False,
    )),
) -> object:
    return await person.post_resend_otp(s, client_ip(request))

@app.post('/check-otp')
async def post_check_otp(
    request: Request,
    req: t.PostCheckOtp,
    s: t.SessionInfo = Depends(session(
        expected_onboarding_status=None,
        expected_sign_in_status=False,
    )),
    _default_limited: None = Depends(default_rate_limit()),
    _ip_limited: None = Depends(rate_limit(
        auth_rate_limit,
        scope='check_otp',
        exempt_when=disable_ip_rate_limit,
    )),
    _account_limited: None = Depends(rate_limit(
        auth_rate_limit,
        scope='check_otp',
        key_func=limiter_account,
        exempt_when=disable_account_rate_limit,
    )),
) -> object:
    return await person.post_check_otp(req, s, client_ip(request))

@app.post('/sign-in-with-google')
async def post_sign_in_with_google(
    request: Request,
    req: t.PostSignInWithGoogle,
    _default_limited: None = Depends(default_rate_limit()),
    _limited: None = Depends(rate_limit(
        auth_rate_limit,
        scope='social_sign_in',
        exempt_when=disable_ip_rate_limit,
    )),
) -> object:
    return await person.post_sign_in_with_google(
        token=req.id_token,
        pending_club_name=req.pending_club_name,
        remote_addr=client_ip(request),
    )

@app.post('/sign-in-with-apple')
async def post_sign_in_with_apple(
    request: Request,
    req: t.PostSignInWithApple,
    _default_limited: None = Depends(default_rate_limit()),
    _limited: None = Depends(rate_limit(
        auth_rate_limit,
        scope='social_sign_in',
        exempt_when=disable_ip_rate_limit,
    )),
) -> object:
    return await person.post_sign_in_with_apple(
        token=req.identity_token,
        nonce=req.nonce,
        pending_club_name=req.pending_club_name,
        remote_addr=client_ip(request),
    )

# Apple Sign-In web/Android OAuth callback. This remains unauthenticated:
# Apple POSTs a form body here, which we convert into a redirect response for
# the client-controlled return URL. See `auth/apple_oauth.py` for the rationale.
#
# This is on its own scope so it doesn't double-bill against
# `social_sign_in`: a single web/Android Apple sign-in hits this
# callback *and* /sign-in-with-apple, and we want the per-day budget
# to be "one sign-in = one slot" not "two slots".
@app.post('/auth/apple/callback')
async def post_auth_apple_callback(
    request: Request,
    _default_limited: None = Depends(default_rate_limit()),
    _limited: None = Depends(rate_limit(
        auth_rate_limit,
        scope='apple_oauth_callback',
        exempt_when=disable_ip_rate_limit,
    )),
) -> object:
    raw_body = await request.body()
    form = dict(parse_qsl(
        raw_body.decode('utf-8', 'ignore'),
        keep_blank_values=True,
    ))
    return apple_oauth.handle_callback(
        id_token=cast(str, form.get('id_token') or ''),
        state=cast(str, form.get('state') or ''),
        error=cast(Optional[str], form.get('error')),
    )

@app.post('/sign-out')
async def post_sign_out(
    request: Request,
    s: t.SessionInfo = Depends(session(expected_onboarding_status=None)),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    await person.post_sign_out(s)
    return None

@app.post('/check-session-token')
async def post_check_session_token(
    request: Request,
    s: t.SessionInfo = Depends(session(expected_onboarding_status=None)),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.post_check_session_token(s)

@app.get('/search-locations')
async def get_search_locations(
    request: Request,
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await location.get_search_locations(request.query_params.get('q'))

@app.patch('/onboardee-info')
async def patch_onboardee_info(
    request: Request,
    req: t.PatchOnboardeeInfo,
    s: t.SessionInfo = Depends(session(expected_onboarding_status=False)),
    _default_limited: None = Depends(default_rate_limit()),
    _account_limited: None = Depends(rate_limit(
        default_limits,
        key_func=limiter_account,
        exempt_when=disable_account_rate_limit,
    )),
) -> object:
    return await person.patch_onboardee_info(req, s)

@app.post('/finish-onboarding')
async def post_finish_onboarding(
    request: Request,
    s: t.SessionInfo = Depends(session(expected_onboarding_status=False)),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.post_finish_onboarding(s)

@app.get('/next-questions')
async def get_next_questions(
    request: Request,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await question.get_next_questions(
        s=s,
        n=request.query_params.get('n', '10'),
        o=request.query_params.get('o', '0'),
    )

@app.get('/public-next-questions')
async def get_public_next_questions(
    request: Request,
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await question.get_public_next_questions(
        n=request.query_params.get('n', '10'),
        o=request.query_params.get('o', '0'),
    )

@app.post('/answer')
async def post_answer(
    request: Request,
    req: t.PostAnswer,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await qanda.post_answer(req, s)

@app.delete('/answer')
async def delete_answer(
    request: Request,
    req: t.DeleteAnswer,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await qanda.delete_answer(req, s)

@app.get('/search')
async def get_search(
    request: Request,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    n = request.query_params.get('n')
    o = request.query_params.get('o')

    rawClub = request.query_params.get('club')
    lowerClub = None if rawClub is None else rawClub.lower().strip()

    club = (
        search.ClubHttpArg(lowerClub if lowerClub != '\0' else None)
        if 'club' in request.query_params
        else None
    )

    search_type, _ = search.get_search_type(n, o)

    limit = "15 per 2 minutes"
    scope = json.dumps([search_type, lowerClub])

    if search_type == 'uncached-search':
        await run_in_threadpool(
            limiter.check,
            request,
            limit,
            scope=scope,
            exempt_when=disable_ip_rate_limit,
        )
        await run_in_threadpool(
            limiter.check,
            request,
            limit,
            scope=scope,
            key_func=limiter_account,
            exempt_when=disable_account_rate_limit,
        )

    return await search.get_search(s=s, n=n, o=o, club=club)

@app.get('/public-search')
async def get_public_search(
    request: Request,
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await search.get_public_search(
        n=request.query_params.get('n'),
        o=request.query_params.get('o'),
        answers=request.query_params.get('answers'),
    )

@app.get('/health')
async def get_health(request: Request) -> object:
    return 'status: ok'

@app.get('/prospect-profile/{prospect_handle}')
async def get_prospect_profile(
    request: Request,
    prospect_handle: str,
    s: Optional[t.SessionInfo] = Depends(session(optional=True)),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_prospect_profile(s, prospect_handle)

@app.get('/conversation-prospect/{prospect_uuid}')
async def get_conversation_prospect(
    request: Request,
    prospect_uuid: str,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_conversation_prospect(s, prospect_uuid)

@app.post('/skip/by-uuid/{prospect_uuid}')
async def post_skip_by_uuid(
    request: Request,
    prospect_uuid: str,
    req: t.PostSkip = Body(default_factory=t.PostSkip),
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    limit = "1 per 5 seconds; 20 per day"
    scope = "report"

    if req.report_reason:
        await run_in_threadpool(
            limiter.check,
            request,
            limit,
            scope=scope,
            exempt_when=disable_ip_rate_limit)
        await run_in_threadpool(
            limiter.check,
            request,
            limit,
            scope=scope,
            key_func=limiter_account,
            exempt_when=disable_account_rate_limit)

    await skip_by_uuid(
        subject_uuid=cast(str, s.person_uuid),
        object_uuid=prospect_uuid,
        reason=req.report_reason or '',
    )
    return None

@app.post('/unskip/by-uuid/{prospect_uuid}')
async def post_unskip_by_uuid(
    request: Request,
    prospect_uuid: str,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    await person.post_unskip_by_uuid(s, prospect_uuid)
    return None

@app.get('/compare-personalities/{prospect_person_id:int}/{topic}')
async def get_compare_personalities(
    request: Request,
    prospect_person_id: int,
    topic: str = FastApiPath(pattern='^(mbti|big5|attachment|politics|other)$'),
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_compare_personalities(s, prospect_person_id, topic)

@app.get('/compare-answers/{prospect_person_id:int}')
async def get_compare_answers(
    request: Request,
    prospect_person_id: int,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_compare_answers(
        s,
        prospect_person_id,
        agreement=request.query_params.get('agreement'),
        topic=request.query_params.get('topic'),
        n=request.query_params.get('n', '10'),
        o=request.query_params.get('o', '0'),
    )

@app.post('/inbox-info')
async def post_inbox_info(
    request: Request,
    req: t.PostInboxInfo,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.post_inbox_info(req, s)

@app.delete('/account')
async def delete_account(
    request: Request,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.delete_or_ban_account(s=s)

@app.post('/deactivate')
async def post_deactivate(
    request: Request,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    await person.post_deactivate(s=s)
    return None

@app.get('/profile-info')
async def get_profile_info(
    request: Request,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_profile_info(s)

@app.delete('/profile-info')
async def delete_profile_info(
    request: Request,
    req: t.DeleteProfileInfo,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    await person.delete_profile_info(req, s)
    return None

@app.patch('/profile-info')
async def patch_profile_info(
    request: Request,
    req: t.PatchProfileInfo,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.patch_profile_info(req, s)

@app.get('/search-filters')
async def get_search_filers(
    request: Request,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_search_filters(s)

@app.post('/search-filter')
async def post_search_filter(
    request: Request,
    req: t.PostSearchFilter,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.post_search_filter(req, s)

@app.get('/search-filter-questions')
async def get_search_filter_questions(
    request: Request,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await question.get_search_filter_questions(
        s=s,
        q=request.query_params.get('q', ''),
        n=request.query_params.get('n', '10'),
        o=request.query_params.get('o', '0'),
    )

@app.post('/search-filter-answer')
async def post_search_filter_answer(
    request: Request,
    req: t.PostSearchFilterAnswer,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.post_search_filter_answer(req, s)

@app.get('/search-clubs')
async def get_search_clubs(
    request: Request,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_search_clubs(
        s=s,
        search_str=request.query_params.get('q', ''),
    )

@app.get('/search-public-clubs')
async def get_search_public_clubs(
    request: Request,
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_search_clubs(
        s=None,
        search_str=request.query_params.get('q', ''),
        allow_empty=True,
    )

@app.get('/club/{name:path}')
async def get_club(
    request: Request,
    name: str,
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    result = await person.get_club(
        name=name,
        ttl_hash=get_ttl_hash(seconds=300))
    if result is None:
        return '', 404
    return result

@app.post('/join-club')
async def post_join_club(
    request: Request,
    req: t.PostJoinClub,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.post_join_club(req, s)

@app.post('/leave-club')
async def post_leave_club(
    request: Request,
    req: t.PostLeaveClub,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    await person.post_leave_club(req, s)
    return None

@app.get('/update-notifications')
async def get_update_notifications(
    request: Request,
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_update_notifications(
        email=request.query_params.get('email', ''),
        type=request.query_params.get('type', ''),
        frequency=request.query_params.get('frequency', ''),
    )

@app.get('/feed')
async def get_feed(
    request: Request,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    valid_datetime = t.ValidDatetime.model_validate(
        {'datetime': request.query_params.get('before')}
    )

    return await search.get_feed(s=s, before=valid_datetime.datetime)

@app.post('/verification-selfie')
async def post_verification_selfie(
    request: Request,
    req: t.PostVerificationSelfie,
    s: t.SessionInfo = Depends(session()),
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.post_verification_selfie(req, s)

@app.post('/verify')
async def post_verify(
    request: Request,
    s: t.SessionInfo = Depends(session()),
    _ip_limited: None = Depends(rate_limit(
        "8 per day",
        scope="verify",
        exempt_when=disable_ip_rate_limit,
    )),
    _account_limited: None = Depends(rate_limit(
        "8 per day",
        scope="verify",
        key_func=limiter_account,
        exempt_when=disable_account_rate_limit,
    )),
) -> object:
    await person.post_verify(s)
    return None

# Reference example of the FastAPI-native, fully-async endpoint style we're
# migrating toward (contrast the manual `@aget`/`@get` handlers around it).
# Auth and rate limiting are `Depends(...)`, the DB read is async, and
# `@duo_route` keeps the same plain-value return convention. The building
# blocks live in `service.api.decorators`.
@app.get('/check-verification')
async def get_check_verification(
    _limited: None = Depends(default_rate_limit()),
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await person.get_check_verification(s)

@app.get('/stats')
async def get_stats(
    request: Request,
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_stats(
        ttl_hash=get_ttl_hash(seconds=60),
        club_name=request.query_params.get('club-name'))

@app.get('/gender-stats')
async def get_gender_stats(
    request: Request,
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_gender_stats(ttl_hash=get_ttl_hash(seconds=60))

@app.get('/admin/ban-link/{token}')
async def get_admin_ban_link(
    request: Request,
    token: str,
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_admin_ban_link(token)

@app.get('/admin/ban/{token}')
async def get_admin_ban(
    request: Request,
    token: str,
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_admin_ban(token)

@app.get('/admin/delete-photo-link/{token}')
async def get_admin_delete_photo_link(
    request: Request,
    token: str,
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_admin_delete_photo_link(token)

@app.get('/admin/delete-photo/{token}')
async def get_admin_delete_photo(
    request: Request,
    token: str,
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_admin_delete_photo(token)

@app.get('/export-data-token')
async def get_export_data_token(
    request: Request,
    s: t.SessionInfo = Depends(session()),
    _ip_limited: None = Depends(rate_limit(
        "3 per day",
        scope="export_data_token",
        exempt_when=disable_ip_rate_limit,
    )),
    _account_limited: None = Depends(rate_limit(
        "3 per day",
        scope="export_data_token",
        key_func=limiter_account,
        exempt_when=disable_account_rate_limit,
    )),
) -> object:
    return await person.get_export_data_token(s=s)

@app.get('/export-data/{token}')
async def get_export_data(
    request: Request,
    token: str,
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.get_export_data(token=token)

@app.post('/revenuecat')
async def post_revenuecat(
    request: Request,
    req: t.PostRevenuecat,
    _default_limited: None = Depends(default_rate_limit()),
) -> object:
    return await person.post_revenuecat(
        req, request.headers.get('Authorization', ''))
