from serviceshared.duoenv.read import (
    csv,
    float_with,
    int_with,
    required_str,
    str_with,
    stripped_str,
)

ENV = required_str('DUO_ENV')

CORS_ORIGINS = str_with('DUO_CORS_ORIGINS', '*')
COMMIT_HASH = str_with('DUO_COMMIT_HASH', 'unknown')

REDIS_HOST = str_with('DUO_REDIS_HOST', 'redis')
REDIS_PORT = int_with('DUO_REDIS_PORT', 6379)

FIREHOL_URL = str_with('DUO_FIREHOL_URL', 'http://firehol:5070')
# Container-to-container lookups are fast, but we keep the timeout short so a
# slow or unavailable FireHOL container never stalls an auth request; we just
# fail open instead.
FIREHOL_TIMEOUT = float_with('DUO_FIREHOL_TIMEOUT', 0.02)

RIPE_URL = str_with('DUO_RIPE_URL', 'https://stat.ripe.net')
RIPE_TIMEOUT = float_with('DUO_RIPE_TIMEOUT', 3.0)

GOOGLE_CLIENT_IDS = csv('DUO_GOOGLE_CLIENT_IDS')
APPLE_CLIENT_IDS = csv('DUO_APPLE_CLIENT_IDS')

APPLE_WEB_REDIRECT_URL = stripped_str('DUO_APPLE_WEB_REDIRECT_URL')
APPLE_APEX_REDIRECT_URL = stripped_str('DUO_APPLE_APEX_REDIRECT_URL')
APPLE_ANDROID_REDIRECT_URL = stripped_str('DUO_APPLE_ANDROID_REDIRECT_URL')

DISCORD_CLIENT_ID = required_str('DUO_DISCORD_CLIENT_ID')
DISCORD_CLIENT_SECRET = required_str('DUO_DISCORD_CLIENT_SECRET')
DISCORD_REDIRECT_URI = str_with(
    'DUO_DISCORD_REDIRECT_URI',
    'https://api.duolicious.app/auth/discord/callback',
)
DISCORD_AUTHORIZE_URL = str_with(
    'DUO_DISCORD_AUTHORIZE_URL',
    'https://discord.com/oauth2/authorize',
)
DISCORD_API_URL = str_with('DUO_DISCORD_API_URL', 'https://discord.com/api/v10')
DISCORD_WEB_REDIRECT_URL = str_with(
    'DUO_DISCORD_WEB_REDIRECT_URL',
    'https://web.duolicious.app/',
)
DISCORD_APEX_REDIRECT_URL = str_with(
    'DUO_DISCORD_APEX_REDIRECT_URL',
    'https://duolicious.app/',
)
DISCORD_APP_REDIRECT_URL = str_with(
    'DUO_DISCORD_APP_REDIRECT_URL',
    'app.duolicious://oauthredirect/discord',
)

SPOTIFY_REDIRECT_URI = str_with(
    'DUO_SPOTIFY_REDIRECT_URI',
    'https://api.duolicious.app/spotify/callback',
)
SPOTIFY_AUTHORIZE_URL = str_with(
    'DUO_SPOTIFY_AUTHORIZE_URL',
    'https://accounts.spotify.com/authorize',
)
SPOTIFY_WEB_REDIRECT_URL = str_with(
    'DUO_SPOTIFY_WEB_REDIRECT_URL',
    'https://web.duolicious.app/profile',
)
SPOTIFY_APEX_REDIRECT_URL = str_with(
    'DUO_SPOTIFY_APEX_REDIRECT_URL',
    'https://duolicious.app/profile',
)
SPOTIFY_APP_REDIRECT_URL = str_with(
    'DUO_SPOTIFY_APP_REDIRECT_URL',
    'app.duolicious://spotify',
)

PAYPAL_API_URL = str_with('DUO_PAYPAL_API_URL', 'https://api-m.paypal.com')
PAYPAL_CLIENT_ID = required_str('DUO_PAYPAL_CLIENT_ID')
PAYPAL_CLIENT_SECRET = required_str('DUO_PAYPAL_CLIENT_SECRET')
PAYPAL_WEBHOOK_ID = required_str('DUO_PAYPAL_WEBHOOK_ID')
PAYPAL_RETURN_URL = str_with('DUO_PAYPAL_RETURN_URL', 'https://api.duolicious.app/paypal/return')
PAYPAL_WEB_REDIRECT_URL = str_with('DUO_PAYPAL_WEB_REDIRECT_URL', 'https://web.duolicious.app/')
PAYPAL_APEX_REDIRECT_URL = str_with('DUO_PAYPAL_APEX_REDIRECT_URL', 'https://duolicious.app/')

VAPID_SUBJECT = str_with('DUO_VAPID_SUBJECT', 'mailto:support@duolicious.app')
VAPID_PRIVATE_KEY = str_with('DUO_VAPID_PRIVATE_KEY', '')
