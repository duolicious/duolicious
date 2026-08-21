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

VAPID_SUBJECT = str_with('DUO_VAPID_SUBJECT', 'mailto:support@duolicious.app')
VAPID_PRIVATE_KEY = str_with('DUO_VAPID_PRIVATE_KEY', '')
