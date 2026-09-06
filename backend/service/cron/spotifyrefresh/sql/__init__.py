# `artists_synced_at` (last successful artist store) drives staleness;
# `refreshed_at` (last attempt) drives retry backoff. Keeping them separate is
# what lets a failed fetch retry after `retry_seconds` instead of waiting out
# the full `max_age_days`.
Q_STALE_PERSON_SPOTIFY_BATCH = """
SELECT
    person_id,
    access_token,
    refresh_token,
    access_token_expires_at < NOW() + INTERVAL '5 minutes' AS needs_refresh
FROM
    person_spotify
WHERE
    (
        artists_synced_at IS NULL
    OR
        artists_synced_at < NOW() - make_interval(days => %(max_age_days)s)
    )
AND
    refreshed_at < NOW() - make_interval(secs => %(retry_seconds)s)
ORDER BY
    refreshed_at
LIMIT
    %(batch_size)s
"""
