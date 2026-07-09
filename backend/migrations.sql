-- Onboardees can no longer upload photos; the table is unused. Any objects
-- still referenced only by this table will be garbage-collected by the
-- `checkphotos` cron job once it stops considering `onboardee_photo`.
DROP TABLE IF EXISTS onboardee_photo;

-- Record the ASN(s) of the IP addresses of new sign-ups, so that patterns of
-- abuse can be analysed. Existing rows aren't backfilled.
ALTER TABLE duo_session
    ADD COLUMN IF NOT EXISTS asns TEXT[];
