Q_INSERT_SPOTIFY_OAUTH_STATE = """
INSERT INTO spotify_oauth_state (
    state,
    person_id
)
SELECT
    %(state)s,
    id
FROM
    person
WHERE
    id = %(person_id)s
AND
    'spotify-tester' = ANY(roles)
RETURNING
    1
"""

# Single-use, bound to the person who minted it, and re-checks the role so a
# state minted before the role was revoked can't complete the flow.
Q_TAKE_SPOTIFY_OAUTH_STATE = """
DELETE FROM
    spotify_oauth_state
USING
    person
WHERE
    person.id = spotify_oauth_state.person_id
AND
    state = %(state)s
AND
    expires_at > NOW()
AND
    'spotify-tester' = ANY(person.roles)
RETURNING
    spotify_oauth_state.person_id
"""

# A NULL `top_artists` means the fetch failed: the tokens are still stored so
# the refresh cron can backfill, and any previous list is kept.
Q_UPSERT_PERSON_SPOTIFY = """
INSERT INTO person_spotify (
    person_id,
    access_token,
    access_token_expires_at,
    refresh_token,
    top_artists,
    artists_synced_at
)
SELECT
    id,
    %(access_token)s,
    NOW() + make_interval(secs => %(expires_in)s),
    %(refresh_token)s,
    COALESCE(%(top_artists)s::jsonb, '[]'::jsonb),
    CASE WHEN %(top_artists)s::jsonb IS NULL THEN NULL ELSE NOW() END
FROM
    person
WHERE
    id = %(person_id)s
ON CONFLICT (person_id) DO UPDATE SET
    access_token = EXCLUDED.access_token,
    access_token_expires_at = EXCLUDED.access_token_expires_at,
    refresh_token = EXCLUDED.refresh_token,
    refreshed_at = NOW(),
    top_artists = COALESCE(%(top_artists)s::jsonb, person_spotify.top_artists),
    artists_synced_at = COALESCE(
        EXCLUDED.artists_synced_at,
        person_spotify.artists_synced_at
    )
RETURNING
    1
"""

# Update-only so a refresh in flight while the person disconnects can't
# resurrect the connection. NULL tokens only bump `refreshed_at` so the cron
# queue rotates; NULL `top_artists` keeps the previous list.
Q_UPDATE_PERSON_SPOTIFY = """
UPDATE
    person_spotify
SET
    access_token = COALESCE(%(access_token)s, access_token),
    access_token_expires_at = COALESCE(
        NOW() + make_interval(secs => %(expires_in)s),
        access_token_expires_at
    ),
    refresh_token = COALESCE(%(refresh_token)s, refresh_token),
    refreshed_at = NOW(),
    top_artists = COALESCE(%(top_artists)s::jsonb, top_artists),
    artists_synced_at = CASE
        WHEN %(top_artists)s::jsonb IS NULL THEN artists_synced_at
        ELSE NOW()
    END
WHERE
    person_id = %(person_id)s
RETURNING
    1
"""

# Spotify policy requires deleting the user's content when authorization
# ends, so /disconnect-spotify and revocation share this.
Q_DISCONNECT_SPOTIFY = """
DELETE FROM
    person_spotify
WHERE
    person_id = %(person_id)s
"""
