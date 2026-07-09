"""The API service's HTTP routes.

Each `@app.<method>` handler is a thin adapter: it pulls typed inputs and the
authenticated session off the request, delegates to a business module
(`person`, `search`, `qanda`, ...), and returns a plain value that `DuoRoute`
renders into a `Response`. The `app` itself (middleware, auth, rate limiting,
lifespan) is assembled in `service.api.asgi`; database bootstrap/migration lives
in `service.api.bootstrap`.
"""

import json
import time
from urllib.parse import parse_qsl

from fastapi import Body, Depends, Path as FastApiPath, WebSocket
from starlette.requests import Request

import duotypes as t
import location
import person
import qanda
import search
from antiabuse.lodgereport import skip_by_uuid
from auth import apple_oauth
from qanda import question
from service.api.asgi import app
from service.api.auth import session
from service.api.ratelimit import (
    auth_rate_limit,
    client_ip,
    default_limits,
    shared_otp_limit_dependency,
    ip_rate_limit,
    account_rate_limit,
    ip_and_account_rate_limit,
    check_ip_and_account,
    search_rate_limit,
    report_rate_limit,
    verify_rate_limit,
    export_data_rate_limit,
)
from service.api.routing import rate_limit_exempt
from service.api.chat import process_websocket_messages
from util.coerce import string

def get_ttl_hash(seconds: int = 10) -> int:
    """Return a value that stays constant within each `seconds`-long window, so
    a `@lru_cache`d function keyed on it recomputes at most once per window."""
    return round(time.time() / seconds)

@app.post('/request-otp')
async def post_request_otp(
    request: Request,
    req: t.PostRequestOtp,
    _shared_limited: None = Depends(shared_otp_limit_dependency),
) -> object:
    return await person.post_request_otp(req, client_ip(request))

@app.post('/resend-otp')
async def post_resend_otp(
    request: Request,
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
    _limited: None = Depends(ip_and_account_rate_limit(
        auth_rate_limit,
        scope='check_otp',
    )),
) -> object:
    return await person.post_check_otp(req, s, client_ip(request))

@app.post('/sign-in-with-google')
async def post_sign_in_with_google(
    request: Request,
    req: t.PostSignInWithGoogle,
    _limited: None = Depends(ip_rate_limit(
        auth_rate_limit,
        scope='social_sign_in',
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
    _limited: None = Depends(ip_rate_limit(
        auth_rate_limit,
        scope='social_sign_in',
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
    _limited: None = Depends(ip_rate_limit(
        auth_rate_limit,
        scope='apple_oauth_callback',
    )),
) -> object:
    raw_body = await request.body()
    form = dict(parse_qsl(
        raw_body.decode('utf-8', 'ignore'),
        keep_blank_values=True,
    ))
    return apple_oauth.handle_callback(
        id_token=form.get('id_token') or '',
        state=form.get('state') or '',
        error=form.get('error'),
    )

@app.post('/sign-out')
async def post_sign_out(
    s: t.SessionInfo = Depends(session(expected_onboarding_status=None)),
) -> object:
    await person.post_sign_out(s)
    return None

@app.post('/check-session-token')
async def post_check_session_token(
    s: t.SessionInfo = Depends(session(expected_onboarding_status=None)),
) -> object:
    return await person.post_check_session_token(s)

@app.get('/search-locations')
async def get_search_locations(
    request: Request,
    s: t.SessionInfo = Depends(session(
        expected_onboarding_status=None,
        expected_sign_in_status=None,
    )),
) -> object:
    return await location.get_search_locations(request.query_params.get('q'))

@app.patch('/onboardee-info')
async def patch_onboardee_info(
    req: t.PatchOnboardeeInfo,
    s: t.SessionInfo = Depends(session(expected_onboarding_status=False)),
    _account_limited: None = Depends(account_rate_limit(default_limits)),
) -> object:
    return await person.patch_onboardee_info(req, s)

@app.post('/finish-onboarding')
async def post_finish_onboarding(
    s: t.SessionInfo = Depends(session(expected_onboarding_status=False)),
) -> object:
    return await person.post_finish_onboarding(s)

@app.get('/next-questions')
async def get_next_questions(
    request: Request,
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await question.get_next_questions(
        s=s,
        n=request.query_params.get('n', '10'),
        o=request.query_params.get('o', '0'),
    )

@app.get('/public-next-questions')
async def get_public_next_questions(request: Request) -> object:
    return await question.get_public_next_questions(
        n=request.query_params.get('n', '10'),
        o=request.query_params.get('o', '0'),
    )

@app.post('/answer')
async def post_answer(
    req: t.PostAnswer,
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await qanda.post_answer(req, s)

@app.delete('/answer')
async def delete_answer(
    req: t.DeleteAnswer,
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await qanda.delete_answer(req, s)

@app.get('/search')
async def get_search(
    request: Request,
    s: t.SessionInfo = Depends(session())
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

    scope = json.dumps([search_type, lowerClub])

    if search_type == 'uncached-search':
        await check_ip_and_account(request, search_rate_limit, scope=scope)

    return await search.get_search(s=s, n=n, o=o, club=club)

@app.get('/public-search')
async def get_public_search(request: Request) -> object:
    return await search.get_public_search(
        n=request.query_params.get('n'),
        o=request.query_params.get('o'),
        answers=request.query_params.get('answers'),
    )

@app.get('/health')
@rate_limit_exempt
async def get_health() -> object:
    return 'status: ok'

@app.get('/prospect-profile/{prospect_handle}')
async def get_prospect_profile(
    prospect_handle: str,
    s: t.SessionInfo | None = Depends(session(optional=True)),
) -> object:
    return await person.get_prospect_profile(s, prospect_handle)

@app.get('/conversation-prospect/{prospect_uuid}')
async def get_conversation_prospect(
    prospect_uuid: str,
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await person.get_conversation_prospect(s, prospect_uuid)

@app.post('/skip/by-uuid/{prospect_uuid}')
async def post_skip_by_uuid(
    request: Request,
    prospect_uuid: str,
    req: t.PostSkip = Body(default_factory=t.PostSkip),
    s: t.SessionInfo = Depends(session()),
) -> object:
    if req.report_reason:
        await check_ip_and_account(request, report_rate_limit, scope="report")

    await skip_by_uuid(
        subject_uuid=string(s.person_uuid, 'person_uuid'),
        object_uuid=prospect_uuid,
        reason=req.report_reason or '',
    )
    return None

@app.post('/unskip/by-uuid/{prospect_uuid}')
async def post_unskip_by_uuid(
    prospect_uuid: str,
    s: t.SessionInfo = Depends(session()),
) -> object:
    await person.post_unskip_by_uuid(s, prospect_uuid)
    return None

@app.get('/compare-personalities/{prospect_person_id:int}/{topic}')
async def get_compare_personalities(
    prospect_person_id: int,
    topic: str = FastApiPath(pattern='^(mbti|big5|attachment|politics|other)$'),
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await person.get_compare_personalities(s, prospect_person_id, topic)

@app.get('/compare-answers/{prospect_person_id:int}')
async def get_compare_answers(
    request: Request,
    prospect_person_id: int,
    s: t.SessionInfo = Depends(session()),
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
    req: t.PostInboxInfo,
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await person.post_inbox_info(req, s)

@app.delete('/account')
async def delete_account(
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await person.delete_or_ban_account(s=s)

@app.post('/deactivate')
async def post_deactivate(
    s: t.SessionInfo = Depends(session()),
) -> object:
    await person.post_deactivate(s=s)
    return None

@app.get('/profile-info')
async def get_profile_info(
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await person.get_profile_info(s)

@app.delete('/profile-info')
async def delete_profile_info(
    req: t.DeleteProfileInfo,
    s: t.SessionInfo = Depends(session()),
) -> object:
    await person.delete_profile_info(req, s)
    return None

@app.patch('/profile-info')
async def patch_profile_info(
    req: t.PatchProfileInfo,
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await person.patch_profile_info(req, s)

@app.get('/search-filters')
async def get_search_filters(
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await person.get_search_filters(s)

@app.post('/search-filter')
async def post_search_filter(
    req: t.PostSearchFilter,
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await person.post_search_filter(req, s)

@app.get('/search-filter-questions')
async def get_search_filter_questions(
    request: Request,
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await question.get_search_filter_questions(
        s=s,
        q=request.query_params.get('q', ''),
        n=request.query_params.get('n', '10'),
        o=request.query_params.get('o', '0'),
    )

@app.post('/search-filter-answer')
async def post_search_filter_answer(
    req: t.PostSearchFilterAnswer,
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await person.post_search_filter_answer(req, s)

@app.get('/search-clubs')
async def get_search_clubs(
    request: Request,
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await person.get_search_clubs(
        s=s,
        search_str=request.query_params.get('q', ''),
    )

@app.get('/search-public-clubs')
async def get_search_public_clubs(request: Request) -> object:
    return await person.get_search_clubs(
        s=None,
        search_str=request.query_params.get('q', ''),
        allow_empty=True,
    )

@app.get('/club/{name:path}')
async def get_club(name: str) -> object:
    result = await person.get_club(
        name=name,
        ttl_hash=get_ttl_hash(seconds=300))
    if result is None:
        return '', 404
    return result

@app.post('/join-club')
async def post_join_club(
    req: t.PostJoinClub,
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await person.post_join_club(req, s)

@app.post('/leave-club')
async def post_leave_club(
    req: t.PostLeaveClub,
    s: t.SessionInfo = Depends(session()),
) -> object:
    await person.post_leave_club(req, s)
    return None

@app.get('/update-notifications')
async def get_update_notifications(request: Request) -> object:
    return await person.get_update_notifications(
        email=request.query_params.get('email', ''),
        type=request.query_params.get('type', ''),
        frequency=request.query_params.get('frequency', ''),
    )

@app.get('/feed')
async def get_feed(
    request: Request,
    s: t.SessionInfo = Depends(session()),
) -> object:
    valid_datetime = t.ValidDatetime.model_validate(
        {'datetime': request.query_params.get('before')}
    )

    return await search.get_feed(s=s, before=valid_datetime.datetime)

@app.get('/feed-v2')
async def get_feed_v2(
    request: Request,
    s: t.SessionInfo = Depends(session()),
) -> object:
    valid_datetime = t.ValidDatetime.model_validate(
        {'datetime': request.query_params.get('before')}
    )

    return await search.get_feed_v2(s=s, before=valid_datetime.datetime)

@app.post('/verification-selfie')
async def post_verification_selfie(
    req: t.PostVerificationSelfie,
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await person.post_verification_selfie(req, s)

@app.post('/verify')
async def post_verify(
    s: t.SessionInfo = Depends(session()),
    _limited: None = Depends(ip_and_account_rate_limit(
        verify_rate_limit,
        scope="verify",
    )),
) -> object:
    await person.post_verify(s)
    return None

@app.get('/check-verification')
async def get_check_verification(
    s: t.SessionInfo = Depends(session()),
) -> object:
    return await person.get_check_verification(s)

@app.get('/stats')
async def get_stats(request: Request) -> object:
    return await person.get_stats(
        ttl_hash=get_ttl_hash(seconds=60),
        club_name=request.query_params.get('club-name'))

@app.get('/gender-stats')
async def get_gender_stats(request: Request) -> object:
    return await person.get_gender_stats(ttl_hash=get_ttl_hash(seconds=60))

@app.get('/admin/ban-link/{token}')
async def get_admin_ban_link(
    token: str,
) -> object:
    return await person.get_admin_ban_link(token)

@app.get('/admin/ban/{token}')
async def get_admin_ban(
    token: str,
) -> object:
    return await person.get_admin_ban(token)

@app.get('/admin/delete-photo-link/{token}')
async def get_admin_delete_photo_link(
    token: str,
) -> object:
    return await person.get_admin_delete_photo_link(token)

@app.get('/admin/delete-photo/{token}')
async def get_admin_delete_photo(
    token: str,
) -> object:
    return await person.get_admin_delete_photo(token)

@app.get('/export-data-token')
async def get_export_data_token(
    s: t.SessionInfo = Depends(session()),
    _limited: None = Depends(ip_and_account_rate_limit(
        export_data_rate_limit,
        scope="export_data_token",
    )),
) -> object:
    return await person.get_export_data_token(s=s)

@app.get('/export-data/{token}')
async def get_export_data(token: str) -> object:
    return await person.get_export_data(token=token)

@app.post('/revenuecat')
async def post_revenuecat(request: Request, req: t.PostRevenuecat) -> object:
    return await person.post_revenuecat(
        req, request.headers.get('Authorization', ''))

@app.websocket('/chat')
async def websocket_chat(websocket: WebSocket) -> None:
    return await process_websocket_messages(websocket)
