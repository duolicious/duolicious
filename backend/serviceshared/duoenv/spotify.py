from serviceshared.duoenv.read import required_str, str_with

SPOTIFY_CLIENT_ID = required_str('DUO_SPOTIFY_CLIENT_ID')
SPOTIFY_CLIENT_SECRET = required_str('DUO_SPOTIFY_CLIENT_SECRET')
SPOTIFY_TOKEN_URL = str_with(
    'DUO_SPOTIFY_TOKEN_URL',
    'https://accounts.spotify.com/api/token',
)
SPOTIFY_API_URL = str_with('DUO_SPOTIFY_API_URL', 'https://api.spotify.com')
