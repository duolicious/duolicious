-- Onboardees can no longer upload photos; the table is unused. Any objects
-- still referenced only by this table will be garbage-collected by the
-- `checkphotos` cron job once it stops considering `onboardee_photo`.
DROP TABLE IF EXISTS onboardee_photo;
