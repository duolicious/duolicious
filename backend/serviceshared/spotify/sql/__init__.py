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

# Single-use: the DELETE consumes the state so a replayed callback can't
# reuse it, and the RETURNING binds the callback to the person who minted it
# (CSRF). The role check re-runs here so a state minted before the role was
# revoked can't complete the flow.
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

Q_UPSERT_PERSON_SPOTIFY = """
INSERT INTO person_spotify (
    person_id,
    access_token,
    access_token_expires_at,
    refresh_token,
    refreshed_at
)
VALUES (
    %(person_id)s,
    %(access_token)s,
    NOW() + make_interval(secs => %(expires_in)s),
    %(refresh_token)s,
    NOW()
)
ON CONFLICT (person_id) DO UPDATE SET
    access_token = EXCLUDED.access_token,
    access_token_expires_at = EXCLUDED.access_token_expires_at,
    refresh_token = EXCLUDED.refresh_token,
    refreshed_at = NOW()
"""

# Update-only counterpart of Q_UPSERT_PERSON_SPOTIFY for the refresh cron:
# matching zero rows (RETURNING nothing) means the person disconnected while
# the refresh was in flight, and re-creating the row would resurrect a
# connection they just asked to remove.
Q_UPDATE_PERSON_SPOTIFY = """
UPDATE
    person_spotify
SET
    access_token = %(access_token)s,
    access_token_expires_at = NOW() + make_interval(secs => %(expires_in)s),
    refresh_token = %(refresh_token)s,
    refreshed_at = NOW()
WHERE
    person_id = %(person_id)s
RETURNING
    1
"""

Q_TOUCH_PERSON_SPOTIFY = """
UPDATE
    person_spotify
SET
    refreshed_at = NOW()
WHERE
    person_id = %(person_id)s
RETURNING
    1
"""

Q_SET_SPOTIFY_ARTISTS = """
UPDATE
    person_spotify
SET
    top_artists = %(top_artists)s::jsonb,
    artists_synced_at = NOW()
WHERE
    person_id = %(person_id)s
"""

# Used both by /disconnect-spotify and by the refresh cron when Spotify
# reports the authorization revoked: Spotify policy requires deleting the
# user's content when authorization ends, so both paths behave identically.
Q_DISCONNECT_SPOTIFY = """
DELETE FROM
    person_spotify
WHERE
    person_id = %(person_id)s
"""

