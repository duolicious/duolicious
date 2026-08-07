-- Schema migrations, applied on every boot (see service/api/bootstrap.py),
-- after init-api.sql has created the base schema on a fresh database. Because
-- this file re-runs against an already-migrated database each time, every
-- statement here MUST be idempotent -- use IF NOT EXISTS / IF EXISTS (or an
-- equivalent guard) so re-running is a no-op.
--
-- Every change here must ALSO be made to init-api.sql, which is the schema a
-- fresh database is created from (this file only reaches existing databases).
-- init-api.sql is the source of truth for the current schema; migrations.sql
-- carries the same change to already-created databases.


-- /export-data and /tripcode joined the static pages copied from
-- duolicious.app to the web frontend, where they're served at the top
-- level -- the same namespace as profile URLs (/<url_slug>). The slugs
-- are now in urlslug's RESERVED_SLUGS so they can't be minted again, but
-- anyone who already holds one would have their profile shadowed by the
-- static page, so they're moved to a numerically-suffixed slug, mirroring
-- what minting would have produced had the name been reserved at sign-up.
-- Idempotent because a rename leaves no rows matching the WHERE clause.
-- No init-api.sql counterpart: this fixes data, not schema.
UPDATE person p
SET url_slug = (
    SELECT p.url_slug || suffix
    FROM generate_series(1, 100000) AS suffix
    WHERE NOT EXISTS (
        SELECT 1 FROM person q WHERE q.url_slug = p.url_slug || suffix
    )
    AND NOT EXISTS (
        SELECT 1 FROM onboardee o WHERE o.url_slug = p.url_slug || suffix
    )
    ORDER BY suffix
    LIMIT 1
)
WHERE p.url_slug IN ('export-data', 'tripcode');

UPDATE onboardee ob
SET url_slug = (
    SELECT ob.url_slug || suffix
    FROM generate_series(1, 100000) AS suffix
    WHERE NOT EXISTS (
        SELECT 1 FROM person q WHERE q.url_slug = ob.url_slug || suffix
    )
    AND NOT EXISTS (
        SELECT 1 FROM onboardee o WHERE o.url_slug = ob.url_slug || suffix
    )
    ORDER BY suffix
    LIMIT 1
)
WHERE ob.url_slug IN ('export-data', 'tripcode');
