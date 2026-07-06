ALTER TABLE person
    ADD COLUMN IF NOT EXISTS came_online_time TIMESTAMP NOT NULL DEFAULT NOW();

-- The chat service only stamps came_online_time from now on, so seed existing
-- rows with last_online_time to keep the feed's ordering continuous across the
-- deployment.
UPDATE person SET came_online_time = last_online_time;

CREATE INDEX IF NOT EXISTS idx__person__came_online_time
    ON person(came_online_time);
