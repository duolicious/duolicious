from duoenv.read import (
    float_with,
    int_with,
    required_int,
    required_str,
    str_or_none,
    str_with,
)

DB_HOST = required_str('DUO_DB_HOST')
DB_PORT = required_str('DUO_DB_PORT')
DB_USER = required_str('DUO_DB_USER')
DB_PASS = required_str('DUO_DB_PASS')
DB_POOL_MIN_SIZE = int_with('DUO_DB_POOL_MIN_SIZE', 1)
DB_POOL_MAX_SIZE = int_with('DUO_DB_POOL_MAX_SIZE', 2)

SMTP_HOST = required_str('DUO_SMTP_HOST')
SMTP_PORT = required_int('DUO_SMTP_PORT')
SMTP_USER = required_str('DUO_SMTP_USER')
SMTP_PASS = required_str('DUO_SMTP_PASS')

REPORT_EMAIL = required_str('DUO_REPORT_EMAIL')

R2_ACCT_ID = required_str('DUO_R2_ACCT_ID')
R2_ACCESS_KEY_ID = required_str('DUO_R2_ACCESS_KEY_ID')
R2_ACCESS_KEY_SECRET = required_str('DUO_R2_ACCESS_KEY_SECRET')
R2_BUCKET_NAME = required_str('DUO_R2_BUCKET_NAME')
R2_AUDIO_BUCKET_NAME = required_str('DUO_R2_AUDIO_BUCKET_NAME')
BOTO_ENDPOINT_URL = str_with(
    'DUO_BOTO_ENDPOINT_URL',
    f'https://{R2_ACCT_ID}.r2.cloudflarestorage.com',
)

# Bounds every outbound request unless the caller overrides it. Keeps a slow
# or unreachable peer from blocking the event loop indefinitely.
HTTP_TIMEOUT = float_with('DUO_HTTP_TIMEOUT', 30.0)

# This should typically be: https://exp.host/--/api/v2/push/send?useFcmV1=true
NOTIFICATION_API_URL = str_with('DUO_NOTIFICATION_API_URL', 'http://localhost')

OFFPEAK_FUNCTION_OVERRIDE = \
    str_with('DUO_OFFPEAK_FUNCTION_OVERRIDE', '').lower()

VERIFICATION_IMAGE_BASE_URL = str_or_none('DUO_VERIFICATION_IMAGE_BASE_URL')
VERIFICATION_MOCK_RESPONSE_FILE = \
    str_or_none('DUO_VERIFICATION_MOCK_RESPONSE_FILE')
