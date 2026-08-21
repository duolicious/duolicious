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

-- Keeps `club.count_members` equal to the number of activated members.
-- The counts were previously maintained by hand at each join / leave /
-- (de)activation / deletion site, which drifted whenever a site was
-- missed (issue #1286).
CREATE OR REPLACE FUNCTION
    maintain_club_count_members()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.activated THEN
        UPDATE club
        SET count_members = count_members + 1
        WHERE name = NEW.club_name;
    ELSIF TG_OP = 'UPDATE' AND NEW.activated AND NOT OLD.activated THEN
        UPDATE club
        SET count_members = count_members + 1
        WHERE name = NEW.club_name;
    ELSIF TG_OP = 'UPDATE' AND OLD.activated AND NOT NEW.activated THEN
        UPDATE club
        SET count_members = count_members - 1
        WHERE name = NEW.club_name;
    ELSIF TG_OP = 'DELETE' AND OLD.activated THEN
        UPDATE club
        SET count_members = count_members - 1
        WHERE name = OLD.club_name;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER
    trigger_maintain_club_count_members
AFTER INSERT OR DELETE OR UPDATE OF activated ON
    person_club
FOR EACH ROW EXECUTE FUNCTION
    maintain_club_count_members();

-- Repair the drift the hand-maintained counts accumulated. Idempotent
-- because a synced count doesn't match the WHERE clause. No init-api.sql
-- counterpart: this fixes data, not schema.
UPDATE club
SET count_members = actual.cnt
FROM (
    SELECT
        club.name,
        COALESCE(pc.cnt, 0) AS cnt
    FROM club
    LEFT JOIN (
        SELECT club_name, count(*) AS cnt
        FROM person_club
        WHERE activated
        GROUP BY club_name
    ) pc ON pc.club_name = club.name
) actual
WHERE club.name = actual.name
AND club.count_members IS DISTINCT FROM actual.cnt;
