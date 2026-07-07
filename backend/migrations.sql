ALTER TABLE person
    ADD COLUMN IF NOT EXISTS unseen_notification_count INT NOT NULL DEFAULT 0;
