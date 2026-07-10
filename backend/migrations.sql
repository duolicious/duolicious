ALTER TABLE duo_session
    ADD COLUMN IF NOT EXISTS asns BIGINT[];

ALTER TABLE inbox
    ADD COLUMN IF NOT EXISTS reaction TEXT,
    ADD COLUMN IF NOT EXISTS reaction_target_mam_id BIGINT,
    ADD COLUMN IF NOT EXISTS reaction_body TEXT;
