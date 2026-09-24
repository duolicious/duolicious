import logging

import httpx
from pydantic import BaseModel
from starlette.responses import RedirectResponse

import service.api.duotypes as t
from service.api.auth.oauth_redirect import redirect
from serviceshared.httpxclient import make_http_client

from serviceshared.duoenv.api import (
    DISCORD_API_URL,
    DISCORD_APEX_REDIRECT_URL,
    DISCORD_APP_REDIRECT_URL,
    DISCORD_AUTHORIZE_URL,
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    DISCORD_REDIRECT_URI,
    DISCORD_WEB_REDIRECT_URL,
)

logger = logging.getLogger(__name__)

_REDIRECT_TARGETS: dict[t.RedirectTarget, str] = {
    'web': DISCORD_WEB_REDIRECT_URL,
    'apex': DISCORD_APEX_REDIRECT_URL,
    'app': DISCORD_APP_REDIRECT_URL,
}


class _Token(BaseModel):
    access_token: str


class _User(BaseModel):
    id: str
    email: str | None = None
    verified: bool = False


def authorize_redirect(q: t.GetDiscordAuthorize) -> RedirectResponse:
    return redirect(
        DISCORD_AUTHORIZE_URL,
        client_id=DISCORD_CLIENT_ID,
        redirect_uri=DISCORD_REDIRECT_URI,
        response_type='code',
        scope='identify email',
        state=q.redirect_target,
        code_challenge=q.code_challenge,
        code_challenge_method='S256',
        prompt='none',
    )


def handle_callback(q: t.GetDiscordCallback) -> RedirectResponse:
    target_url = _REDIRECT_TARGETS[q.state]
    if q.code:
        return redirect(target_url, discord_code=q.code)
    return redirect(target_url, discord_error=q.error or 'missing_code')


async def verify_discord_code(
    code: str,
    code_verifier: str,
) -> t.SocialClaims | None:
    try:
        async with make_http_client() as client:
            token = await client.post(
                f'{DISCORD_API_URL}/oauth2/token',
                data=dict(
                    grant_type='authorization_code',
                    code=code,
                    redirect_uri=DISCORD_REDIRECT_URI,
                    code_verifier=code_verifier,
                ),
                auth=(DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET),
            )
            access_token = _Token.model_validate(
                token.raise_for_status().json()).access_token
            me = await client.get(
                f'{DISCORD_API_URL}/users/@me',
                headers=dict(Authorization=f'Bearer {access_token}'),
            )
            user = _User.model_validate(me.raise_for_status().json())
    except httpx.HTTPStatusError as e:
        logger.warning(
            f'Discord {e.request.url.path} returned HTTP '
            f'{e.response.status_code}: {e.response.text}')
        return None
    except (httpx.HTTPError, ValueError) as e:
        logger.warning(f'Discord sign-in failed: {e}')
        return None

    return t.SocialClaims(
        sub=user.id,
        email=user.email or '',
        email_verified=user.verified,
    )
