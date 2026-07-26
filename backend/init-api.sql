--------------------------------------------------------------------------------
-- EXTENSIONS
--------------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

--------------------------------------------------------------------------------
-- FUNCTIONS (1)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION array_full(dimensions INT, fill_value FLOAT4)
RETURNS FLOAT4[] AS $$
    SELECT ARRAY(SELECT fill_value FROM generate_series(1, dimensions));
$$ LANGUAGE sql IMMUTABLE LEAKPROOF PARALLEL SAFE;

CREATE OR REPLACE FUNCTION array_full(dimensions INT, fill_value INT)
RETURNS INT[] AS $$
    SELECT ARRAY(SELECT fill_value FROM generate_series(1, dimensions));
$$ LANGUAGE sql IMMUTABLE LEAKPROOF PARALLEL SAFE;

CREATE OR REPLACE FUNCTION clamp(lo FLOAT, hi FLOAT, val FLOAT)
RETURNS FLOAT AS $$
    SELECT LEAST(hi, GREATEST(lo, val));
$$ LANGUAGE sql IMMUTABLE LEAKPROOF PARALLEL SAFE;

CREATE OR REPLACE FUNCTION base62_encode(num bigint) RETURNS text AS $$
DECLARE
    characters text := '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    result text := '';
    current int;
BEGIN
    IF num = 0 THEN
        RETURN '0';
    END IF;

    WHILE num > 0 LOOP
        current := num % 62;
        result := substr(characters, current + 1, 1) || result;
        num := num / 62;
    END LOOP;

    RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT;


CREATE OR REPLACE FUNCTION uuid_or_null(str text)
  RETURNS uuid
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
AS $$
    SELECT CASE
        WHEN str ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN str::uuid
    END
$$;


CREATE OR REPLACE FUNCTION iso8601_utc(ts timestamp)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  RETURNS NULL ON NULL INPUT
AS $$
    SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;


CREATE OR REPLACE FUNCTION age_gap_acceptability_odds(
    a double precision,
    b double precision
)
RETURNS double precision
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT exp(-8.0 * d * d)
  FROM (
        SELECT
          1.0 - CASE
                  WHEN a > b
                       THEN (b - 13)::float8 / (a - 13)
                       ELSE (a - 13)::float8 / (b - 13)
                END
          AS d
       ) AS s;
$$;


--------------------------------------------------------------------------------
-- BLOCKED EMAIL DOMAINS
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bad_email_domain (
    domain TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS good_email_domain (
    domain TEXT PRIMARY KEY
);

--------------------------------------------------------------------------------
-- EVENTS
--------------------------------------------------------------------------------

DO $$ BEGIN
    CREATE TYPE person_event AS ENUM (
        'added-photo',
        'added-voice-bio',
        'joined',
        'joined-club',
        'answered-question',
        'updated-bio',
        'was-recently-online',
        'recently-online-with-photo',
        'recently-online-with-voice-bio',
        'recently-online-with-bio'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;


--------------------------------------------------------------------------------
-- BANNED CLUBS
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS banned_club (
    name TEXT PRIMARY KEY,

    CONSTRAINT name CHECK (name = LOWER(name))
);

--------------------------------------------------------------------------------
-- BASICS
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS verification_level (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS gender (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS orientation (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS ethnicity (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS location (
    id SERIAL PRIMARY KEY,
    short_friendly TEXT NOT NULL,
    long_friendly TEXT NOT NULL,
    city TEXT NOT NULL,
    subdivision TEXT NOT NULL,
    country TEXT NOT NULL,
    coordinates GEOGRAPHY(Point, 4326) NOT NULL,
    verification_required BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (short_friendly),
    UNIQUE (long_friendly)
);

CREATE TABLE IF NOT EXISTS looking_for (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS last_online (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    seconds BIGINT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS yes_no (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS yes_country_only_no (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS yes_no_optional (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS yes_no_maybe (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS frequency (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS relationship_status (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS religion (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS star_sign (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS unit (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS immediacy (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    UNIQUE (name)
);

--------------------------------------------------------------------------------
-- MAIN TABLES
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS person (
    id SERIAL,

    id_salt INT DEFAULT FLOOR(RANDOM() * 1000000),
    tiny_id TEXT GENERATED ALWAYS AS (base62_encode(id::BIGINT * 1000000 + id_salt)) STORED,

    uuid UUID NOT NULL DEFAULT uuid_generate_v4(),

    -- Required during sign-up
    email TEXT NOT NULL,
    normalized_email TEXT NOT NULL,
    name TEXT NOT NULL,
    url_slug TEXT NOT NULL,
    date_of_birth DATE NOT NULL,
    coordinates GEOGRAPHY(Point, 4326) NOT NULL,
    gender_id SMALLINT REFERENCES gender(id) NOT NULL,
    about TEXT NOT NULL,

    -- Denormalized location names
    location_short_friendly TEXT NOT NULL,
    location_long_friendly TEXT NOT NULL,
    location_country TEXT NOT NULL,

    -- There's 46 `trait`s. In principle, it's possible for someone to have a
    -- score of 0 for each trait. We add an extra, constant, non-zero dimension
    -- to avoid that.
    personality VECTOR(47) NOT NULL DEFAULT array_full(47, 0),
    presence_score INT[] NOT NULL DEFAULT array_full(46, 0),
    absence_score INT[] NOT NULL DEFAULT array_full(46, 0),
    count_answers SMALLINT NOT NULL DEFAULT 0,

    -- Verification
    has_profile_picture_id SMALLINT REFERENCES yes_no(id) NOT NULL DEFAULT 2,
    verification_level_id SMALLINT REFERENCES verification_level(id) NOT NULL DEFAULT 1,
    verified_age BOOLEAN NOT NULL DEFAULT FALSE,
    verified_gender BOOLEAN NOT NULL DEFAULT FALSE,
    verified_ethnicity BOOLEAN NOT NULL DEFAULT FALSE,
    verification_required BOOLEAN NOT NULL DEFAULT FALSE,

    -- Basics
    orientation_id SMALLINT REFERENCES orientation(id) NOT NULL DEFAULT 1,
    ethnicity_id SMALLINT REFERENCES ethnicity(id) NOT NULL DEFAULT 1,
    occupation TEXT,
    education TEXT,
    height_cm SMALLINT,
    looking_for_id SMALLINT REFERENCES looking_for(id) NOT NULL DEFAULT 1,
    smoking_id SMALLINT REFERENCES yes_no_optional(id) NOT NULL DEFAULT 1,
    drinking_id SMALLINT REFERENCES frequency(id) NOT NULL DEFAULT 1,
    drugs_id SMALLINT REFERENCES yes_no_optional(id) NOT NULL DEFAULT 1,
    long_distance_id SMALLINT REFERENCES yes_no_optional(id) NOT NULL DEFAULT 1,
    relationship_status_id SMALLINT REFERENCES relationship_status(id) NOT NULL DEFAULT 1,
    has_kids_id SMALLINT REFERENCES yes_no_optional(id) NOT NULL DEFAULT 1,
    wants_kids_id SMALLINT REFERENCES yes_no_maybe(id) NOT NULL DEFAULT 1,
    exercise_id SMALLINT REFERENCES frequency(id) NOT NULL DEFAULT 1,
    religion_id SMALLINT REFERENCES religion(id) NOT NULL DEFAULT 1,
    star_sign_id SMALLINT REFERENCES star_sign(id) NOT NULL DEFAULT 1,

    -- Theme
    title_color TEXT NOT NULL DEFAULT '#000000',
    body_color TEXT NOT NULL DEFAULT '#000000',
    background_color TEXT NOT NULL DEFAULT '#ffffff',

    -- General Settings
    unit_id SMALLINT REFERENCES unit(id) NOT NULL,

    -- Notification Settings
    chats_notification SMALLINT REFERENCES immediacy(id) NOT NULL DEFAULT 1,
    intros_notification SMALLINT REFERENCES immediacy(id) NOT NULL DEFAULT 2,
    visitors_notification SMALLINT REFERENCES immediacy(id) NOT NULL DEFAULT 4,

    -- Privacy Settings
    show_my_location_id SMALLINT REFERENCES yes_country_only_no(id) NOT NULL DEFAULT 1,
    show_my_online_status BOOLEAN NOT NULL DEFAULT TRUE,
    show_my_age BOOLEAN NOT NULL DEFAULT TRUE,
    show_my_looking_for BOOLEAN NOT NULL DEFAULT TRUE,
    hide_me_from_strangers BOOLEAN NOT NULL DEFAULT FALSE,
    browse_invisibly BOOLEAN NOT NULL DEFAULT FALSE,
    -- Opt-in: every user (new or existing) starts private and must flip the
    -- "Public Profile" toggle in privacy settings to expose their profile
    -- to anonymous viewers.
    public_profile BOOLEAN NOT NULL DEFAULT FALSE,
    privacy_verification_level_id SMALLINT REFERENCES verification_level(id) NOT NULL DEFAULT 1,

    -- Bookkeeping
    sign_up_time TIMESTAMP NOT NULL DEFAULT NOW(),
    sign_in_count INT NOT NULL DEFAULT 1,
    sign_in_time TIMESTAMP NOT NULL DEFAULT NOW(),
    last_nag_time TIMESTAMP DEFAULT to_timestamp(0),
    last_online_time TIMESTAMP NOT NULL DEFAULT NOW(),
    -- When the user last went from having zero connected chat clients to one.
    -- Unlike last_online_time, which keeps advancing for as long as the user
    -- stays connected, this only advances when a new online session starts,
    -- so ordering the feed by it can't be gamed by staying online 24/7.
    came_online_time TIMESTAMP NOT NULL DEFAULT NOW(),
    last_visitor_check_time TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Whether the account was deactivated via the settings or automatically
    activated BOOLEAN NOT NULL DEFAULT TRUE,

    -- Shadow banned accounts behave normally for the account holder but appear
    -- not to exist from every other user's perspective
    shadow_banned_at TIMESTAMP,

    -- Events
    last_event_time TIMESTAMP NOT NULL DEFAULT NOW(),
    last_event_name person_event NOT NULL DEFAULT 'joined',
    last_event_data JSONB NOT NULL DEFAULT '{}',

    -- Flair and roles
    flair TEXT[] NOT NULL DEFAULT '{}',
    roles TEXT[] NOT NULL DEFAULT '{}',

    -- Subscriptions
    has_gold BOOLEAN NOT NULL DEFAULT FALSE,

    -- Notifications
    intro_seconds INT NOT NULL DEFAULT 0,
    chat_seconds INT NOT NULL DEFAULT 0,
    visitor_seconds INT NOT NULL DEFAULT 0,
    -- How many push notifications were sent while the user had no connected
    -- chat clients. Stamped into each push as the iOS app-icon badge and
    -- zeroed when the user goes from zero connected clients to one.
    unseen_notification_count INT NOT NULL DEFAULT 0,

    -- Primary keys and constraints
    UNIQUE (email),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS unmoderated_person (
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    trait TEXT NOT NULL,

    PRIMARY KEY (person_id, trait)
);

CREATE TABLE IF NOT EXISTS onboardee (
    email TEXT NOT NULL,

    name TEXT,
    url_slug TEXT,
    date_of_birth DATE,
    coordinates GEOGRAPHY(Point, 4326),
    gender_id SMALLINT REFERENCES gender(id),
    about TEXT,

    -- Bookkeeping
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    PRIMARY KEY (email)
);

CREATE TABLE IF NOT EXISTS onboardee_search_preference_gender (
    email TEXT REFERENCES onboardee(email) ON DELETE CASCADE,
    gender_id SMALLINT REFERENCES gender(id) ON DELETE CASCADE,
    PRIMARY KEY (email, gender_id)
);

CREATE TABLE IF NOT EXISTS duo_session (
    session_token_hash TEXT NOT NULL,
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    email TEXT NOT NULL,
    pending_club_name TEXT,
    otp TEXT,
    ip_address inet,
    signed_in BOOLEAN NOT NULL DEFAULT FALSE,
    session_expiry TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '6 months'),
    otp_expiry TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    pending_social_provider TEXT,
    pending_social_sub TEXT,
    push_token TEXT,
    web_push_subscription JSONB,
    last_online_time TIMESTAMP NOT NULL DEFAULT NOW(),
    answers JSONB,
    asns BIGINT[],

    PRIMARY KEY (session_token_hash)
);

CREATE TABLE IF NOT EXISTS social_identity (
    -- 'google' | 'apple'
    provider TEXT NOT NULL,
    -- Stable, opaque user id from the provider (Google `sub`, Apple `sub`).
    -- Source of truth for identity; emails can change (esp. Apple relay).
    provider_sub TEXT NOT NULL,
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    -- Whatever email the provider reported at link time, for diagnostics only.
    -- May be a `@privaterelay.appleid.com` alias.
    email TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider, provider_sub)
);

CREATE INDEX IF NOT EXISTS social_identity__person_id__idx
    ON social_identity (person_id);

-- `width`, `height`, `crop_top` and `crop_left` describe how the square
-- renditions (`900-{uuid}.jpg`, `450-{uuid}.jpg`) were cut out of
-- `original-{uuid}.jpg`, so clients can animate between the two. All four are
-- in the coordinates of `original-{uuid}.jpg`, i.e. after EXIF rotation was
-- applied. The crop is always `min(width, height)` on a side, so only its
-- origin varies. Every upload records them. They stay NULL for the few photos
-- which predate the columns and whose crop the (since-removed) `photocrop`
-- backfill couldn't recover - a permanent state now, not a pending one, which
-- clients render as opening without the expand animation.
CREATE TABLE IF NOT EXISTS photo (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    position SMALLINT NOT NULL,
    uuid TEXT NOT NULL,
    blurhash TEXT NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    nsfw_score FLOAT4,
    extra_exts TEXT[] NOT NULL DEFAULT '{}',
    hash TEXT NOT NULL,
    width INT,
    height INT,
    crop_top INT,
    crop_left INT,
    PRIMARY KEY (person_id, position)
);

CREATE TABLE IF NOT EXISTS undeleted_photo (
    uuid TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS banned_photo_hash (
    hash TEXT NOT NULL,
    PRIMARY KEY (hash)
);

CREATE TABLE IF NOT EXISTS audio (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    position INT NOT NULL,
    uuid TEXT NOT NULL,

    PRIMARY KEY (person_id, position)
);

CREATE TABLE IF NOT EXISTS undeleted_audio (
    uuid TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS question (
    id SMALLSERIAL,
    question TEXT NOT NULL,
    topic TEXT NOT NULL,
    presence_given_yes INT[] NOT NULL,
    presence_given_no INT[] NOT NULL,
    absence_given_yes INT[] NOT NULL,
    absence_given_no INT[] NOT NULL,
    count_yes BIGINT NOT NULL DEFAULT 0,
    count_no BIGINT NOT NULL DEFAULT 0,
    UNIQUE (question),
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS answer (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    question_id SMALLINT NOT NULL REFERENCES question(id) ON DELETE CASCADE ON UPDATE CASCADE,
    answer BOOLEAN,
    public_ BOOLEAN NOT NULL,

    PRIMARY KEY (person_id, question_id)
);

CREATE TABLE IF NOT EXISTS trait (
    id SMALLSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    min_label TEXT,
    max_label TEXT,
    UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS trait_topic (
    trait_id SMALLINT NOT NULL REFERENCES trait(id) ON DELETE CASCADE ON UPDATE CASCADE,
    name TEXT,
    PRIMARY KEY (trait_id, name)
);


DO $$ BEGIN
    CREATE TYPE verification_job_status AS ENUM (
        'uploading-photo',
        'queued',
        'running',
        'success',
        'failure'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS verification_job (
    id SERIAL PRIMARY KEY,
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    status verification_job_status NOT NULL DEFAULT 'uploading-photo',
    message TEXT NOT NULL DEFAULT 'Verifying',
    photo_uuid TEXT NOT NULL,
    raw_json TEXT NOT NULL DEFAULT '',
    expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '3 days')
);

CREATE TABLE IF NOT EXISTS verification_photo_hash (
    hash TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS club (
    name TEXT NOT NULL,
    count_members INT NOT NULL DEFAULT 0,

    PRIMARY KEY (name)
);

CREATE TABLE IF NOT EXISTS person_club (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    club_name TEXT NOT NULL REFERENCES club(name) ON DELETE CASCADE ON UPDATE CASCADE,

    -- Columns are copied from the `person` table to make queries faster
    activated BOOLEAN NOT NULL,
    coordinates GEOGRAPHY(Point, 4326) NOT NULL,
    gender_id SMALLINT NOT NULL,

    PRIMARY KEY (person_id, club_name)
);

-- Queue of clubs needing a club_stats refresh. Maintained by
-- trigger_mark_club_stats_dirty. Kept in a separate table (rather than
-- a flag on `club`) so the cron's clear doesn't UPDATE the same row that
-- /join-club and /leave-club update for `count_members` -- that race
-- raises SerializationFailure on the API under REPEATABLE READ.
CREATE TABLE IF NOT EXISTS club_stats_dirty (
    club_name TEXT PRIMARY KEY REFERENCES club(name) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS club_stats (
    club_name TEXT PRIMARY KEY REFERENCES club(name) ON DELETE CASCADE ON UPDATE CASCADE,
    stats_json JSONB NOT NULL,
    computed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Directed co-membership counts; both directions stored so a club's
-- related list is a single PK range scan.
--
-- `count_members_b` is denormalised so the page read doesn't need to join
-- `club` per related row -- the planner mis-routes equality lookups on
-- club(name) through the trigram GiST (~50 ms cold per lookup).
--
-- club_a/club_b deliberately have NO foreign key to club. The per-row RI
-- check routes through that same trigram GiST and at production cap
-- settings the rebuild emits >100k pairs, pushing it past its statement
-- timeout. The table is fully rewritten every overlap-cron tick from
-- person_club (which is FK'd to club), so a deleted or renamed club
-- leaves stale rows for at most one cron interval.
CREATE TABLE IF NOT EXISTS club_overlap (
    club_a TEXT NOT NULL,
    club_b TEXT NOT NULL,
    overlap INT NOT NULL,
    count_members_b INT NOT NULL,
    PRIMARY KEY (club_a, club_b)
);

CREATE TABLE IF NOT EXISTS club_top_answers (
    club_name TEXT PRIMARY KEY REFERENCES club(name) ON DELETE CASCADE ON UPDATE CASCADE,
    answers_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    computed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- `description`/`stats_hash` are NULL between eligibility and the first
-- successful generation, and after a failed attempt: the row still exists
-- so generated_at advances and the club rotates to the back of the
-- refresh queue instead of blocking it.
CREATE TABLE IF NOT EXISTS club_seo (
    club_name TEXT PRIMARY KEY REFERENCES club(name) ON DELETE CASCADE ON UPDATE CASCADE,
    description TEXT,
    stats_hash TEXT,
    generated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deleted_photo_admin_token (
    token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_uuid TEXT NOT NULL,
    generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '1 month')
);

CREATE TABLE IF NOT EXISTS banned_person_admin_token (
    token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '1 month')
);

CREATE TABLE IF NOT EXISTS export_data_token (
    token UUID PRIMARY key default gen_random_uuid(),
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

CREATE TABLE IF NOT EXISTS banned_person (
    normalized_email TEXT NOT NULL,
    ip_address inet NOT NULL DEFAULT '127.0.0.1',
    banned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '1 month'),
    report_reasons TEXT[] NOT NULL DEFAULT '{}'::TEXT[],

    PRIMARY KEY (normalized_email, ip_address)
);

CREATE TABLE IF NOT EXISTS funding (
    id SMALLINT PRIMARY KEY,

    estimated_end_date TIMESTAMP NOT NULL,
    cost_per_month_usd FLOAT NOT NULL,

    token_hash_revenuecat TEXT NOT NULL DEFAULT '',

    CONSTRAINT id CHECK (id = 1)
);

--------------------------------------------------------------------------------
-- TABLES TO CONNECT PEOPLE TO THEIR SEARCH PREFERENCES
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS search_preference_answer (
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    question_id SMALLINT REFERENCES question(id) ON DELETE CASCADE,
    answer BOOLEAN NOT NULL,
    accept_unanswered BOOLEAN NOT NULL,
    PRIMARY KEY (person_id, question_id)
);

CREATE TABLE IF NOT EXISTS search_preference_gender (
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    gender_id SMALLINT REFERENCES gender(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, gender_id)
);

CREATE TABLE IF NOT EXISTS search_preference_orientation (
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    orientation_id SMALLINT REFERENCES orientation(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, orientation_id)
);

CREATE TABLE IF NOT EXISTS search_preference_ethnicity (
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    ethnicity_id SMALLINT REFERENCES ethnicity(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, ethnicity_id)
);

CREATE TABLE IF NOT EXISTS search_preference_age (
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    min_age SMALLINT,
    max_age SMALLINT,
    PRIMARY KEY (person_id)
);

CREATE TABLE IF NOT EXISTS search_preference_distance (
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    distance SMALLINT,
    PRIMARY KEY (person_id)
);

CREATE TABLE IF NOT EXISTS search_preference_last_online (
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    last_online_id SMALLINT REFERENCES last_online(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id)
);

CREATE TABLE IF NOT EXISTS search_preference_height_cm (
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    min_height_cm SMALLINT,
    max_height_cm SMALLINT,
    PRIMARY KEY (person_id)
);

CREATE TABLE IF NOT EXISTS search_preference_has_profile_picture (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    has_profile_picture_id SMALLINT REFERENCES yes_no(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, has_profile_picture_id)
);

CREATE TABLE IF NOT EXISTS search_preference_looking_for (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    looking_for_id SMALLINT REFERENCES looking_for(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, looking_for_id)
);

CREATE TABLE IF NOT EXISTS search_preference_smoking (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    smoking_id SMALLINT REFERENCES yes_no_optional(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, smoking_id)
);

CREATE TABLE IF NOT EXISTS search_preference_drinking (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    drinking_id SMALLINT REFERENCES frequency(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, drinking_id)
);

CREATE TABLE IF NOT EXISTS search_preference_drugs (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    drugs_id SMALLINT REFERENCES yes_no_optional(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, drugs_id)
);

CREATE TABLE IF NOT EXISTS search_preference_long_distance (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    long_distance_id SMALLINT REFERENCES yes_no_optional(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, long_distance_id)
);

CREATE TABLE IF NOT EXISTS search_preference_relationship_status (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    relationship_status_id SMALLINT REFERENCES relationship_status(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, relationship_status_id)
);

CREATE TABLE IF NOT EXISTS search_preference_has_kids (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    has_kids_id SMALLINT REFERENCES yes_no_optional(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, has_kids_id)
);

CREATE TABLE IF NOT EXISTS search_preference_wants_kids (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    wants_kids_id SMALLINT REFERENCES yes_no_maybe(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, wants_kids_id)
);

CREATE TABLE IF NOT EXISTS search_preference_exercise (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    exercise_id SMALLINT REFERENCES frequency(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, exercise_id)
);

CREATE TABLE IF NOT EXISTS search_preference_religion (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    religion_id SMALLINT REFERENCES religion(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, religion_id)
);

CREATE TABLE IF NOT EXISTS search_preference_star_sign (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    star_sign_id SMALLINT REFERENCES star_sign(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id, star_sign_id)
);

CREATE TABLE IF NOT EXISTS search_preference_club (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    club_name TEXT REFERENCES club(name) ON DELETE CASCADE,
    PRIMARY KEY (person_id)
);

CREATE TABLE IF NOT EXISTS search_preference_messaged (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    messaged_id SMALLINT REFERENCES yes_no(id) ON DELETE CASCADE,
    PRIMARY KEY (person_id)
);

CREATE TABLE IF NOT EXISTS search_preference_skipped (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    skipped_id SMALLINT REFERENCES yes_no(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (person_id)
);

CREATE TABLE IF NOT EXISTS search_preference_two_way_filters (
    person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    gender                BOOLEAN NOT NULL DEFAULT TRUE,
    age                   BOOLEAN NOT NULL DEFAULT FALSE,
    furthest_distance     BOOLEAN NOT NULL DEFAULT FALSE,
    orientation           BOOLEAN NOT NULL DEFAULT FALSE,
    relationship_status   BOOLEAN NOT NULL DEFAULT FALSE,
    looking_for           BOOLEAN NOT NULL DEFAULT FALSE,
    wants_kids            BOOLEAN NOT NULL DEFAULT FALSE,
    has_kids              BOOLEAN NOT NULL DEFAULT FALSE,
    has_a_profile_picture BOOLEAN NOT NULL DEFAULT FALSE,
    drugs                 BOOLEAN NOT NULL DEFAULT FALSE,
    long_distance         BOOLEAN NOT NULL DEFAULT FALSE,
    ethnicity             BOOLEAN NOT NULL DEFAULT FALSE,
    smoking               BOOLEAN NOT NULL DEFAULT FALSE,
    religion              BOOLEAN NOT NULL DEFAULT FALSE,
    drinking              BOOLEAN NOT NULL DEFAULT FALSE,
    height                BOOLEAN NOT NULL DEFAULT FALSE,
    exercise              BOOLEAN NOT NULL DEFAULT FALSE,
    star_sign             BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (person_id)
);

CREATE TABLE IF NOT EXISTS messaged (
    subject_person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    object_person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (subject_person_id, object_person_id)
);

CREATE TABLE IF NOT EXISTS skipped (
    subject_person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    object_person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    reported BOOLEAN NOT NULL DEFAULT FALSE,
    report_reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),

    PRIMARY KEY (subject_person_id, object_person_id)
);

CREATE TABLE IF NOT EXISTS visited (
    subject_person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    object_person_id INT NOT NULL REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    invisible BOOLEAN NOT NULL DEFAULT FALSE,

    PRIMARY KEY (subject_person_id, object_person_id)
);

--------------------------------------------------------------------------------
-- TABLES TO SPEED UP SEARCHING
--------------------------------------------------------------------------------

CREATE UNLOGGED TABLE IF NOT EXISTS search_cache (
    searcher_person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    position SMALLINT,
    prospect_person_id INT NOT NULL,
    prospect_uuid UUID NOT NULL,
    profile_photo_uuid TEXT,
    profile_photo_blurhash TEXT,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    name TEXT NOT NULL,
    age SMALLINT,
    match_percentage SMALLINT NOT NULL,
    personality VECTOR(47) NOT NULL,
    PRIMARY KEY (searcher_person_id, position)
);

--------------------------------------------------------------------------------
-- INDEXES
--------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS
    idx__person__activated__coordinates__gender_id
    ON person
    USING GIST(coordinates, gender_id)
    WHERE activated;

CREATE INDEX IF NOT EXISTS
    idx__person_club__activated__club_name__coordinates__gender_id
    ON person_club
    USING GIST(club_name, coordinates, gender_id)
    WHERE activated;

CREATE INDEX IF NOT EXISTS
    idx__person_club__activated__club_name__person_id
    ON person_club (club_name, person_id)
    WHERE activated;

CREATE INDEX IF NOT EXISTS idx__person__sign_up_time
    ON person(sign_up_time);
CREATE INDEX IF NOT EXISTS idx__person__tiny_id
    ON person(tiny_id);
CREATE INDEX IF NOT EXISTS idx__person__email
    ON person(email);
CREATE INDEX IF NOT EXISTS idx__person__uuid
    ON person(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx__person__url_slug
    ON person(url_slug)
    WHERE url_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx__person__normalized_email
    ON person(normalized_email);
CREATE INDEX IF NOT EXISTS idx__person__last_event_time
    ON person(last_event_time);
CREATE INDEX IF NOT EXISTS idx__person__roles
    ON person
    USING GIN (roles);

CREATE INDEX IF NOT EXISTS idx__search_cache__searcher_person_id__position ON search_cache(searcher_person_id, position);

CREATE INDEX IF NOT EXISTS idx__answer__person_id_public_answer ON answer(person_id, public_, answer);
-- Lets the feed's 'answered-question' facepiles scan a question's public
-- yes/no answerers in person_id order
CREATE INDEX IF NOT EXISTS idx__answer__question_id_public_answer
    ON answer(question_id, public_, answer, person_id);
-- Lets the club-top-answers cron index-only-scan (person, question, answer)
-- instead of doing a heap fetch per row -- the PK is (person_id,
-- question_id) without `answer`. ~80 s -> ~3 s per popular club.
CREATE INDEX IF NOT EXISTS idx__answer__person_id_question_id_inc_answer
    ON answer(person_id, question_id) INCLUDE (answer);

CREATE INDEX IF NOT EXISTS idx__duo_session__email
    ON duo_session(email);
CREATE INDEX IF NOT EXISTS idx__duo_session__session_expiry
    ON duo_session(session_expiry);
CREATE INDEX IF NOT EXISTS idx__duo_session__person_id
    ON duo_session(person_id);

CREATE INDEX IF NOT EXISTS idx__location__coordinates ON location USING GIST(coordinates);
CREATE INDEX IF NOT EXISTS idx__location__long_friendly ON location USING GIST(long_friendly gist_trgm_ops);

CREATE INDEX IF NOT EXISTS idx__question__question ON question USING GIST(question gist_trgm_ops);

CREATE INDEX IF NOT EXISTS idx__club__name ON club USING GIST(name gist_trgm_ops);
CREATE INDEX IF NOT EXISTS idx__club__count_members__name ON club(count_members, name);

CREATE INDEX IF NOT EXISTS idx__banned_person__ip_address ON banned_person(ip_address);
CREATE INDEX IF NOT EXISTS idx__banned_person__expires_at ON banned_person(expires_at);

CREATE INDEX IF NOT EXISTS idx__banned_person_admin_token__expires_at
    ON banned_person_admin_token(expires_at);

CREATE INDEX IF NOT EXISTS idx__export_data_token__expires_at
    ON export_data_token(expires_at);

CREATE INDEX IF NOT EXISTS idx__deleted_photo_admin_token__expires_at
    ON deleted_photo_admin_token(expires_at);

CREATE INDEX IF NOT EXISTS idx__photo__uuid
    ON photo(uuid);

CREATE INDEX IF NOT EXISTS idx__photo__nsfw_score
    ON photo(nsfw_score);

CREATE INDEX IF NOT EXISTS idx__onboardee__created_at
    ON onboardee(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx__onboardee__url_slug
    ON onboardee(url_slug)
    WHERE url_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx__bad_email_domain__domain
    ON bad_email_domain(domain);

CREATE INDEX IF NOT EXISTS idx__good_email_domain__domain
    ON good_email_domain(domain);

CREATE INDEX IF NOT EXISTS idx__verification_job__status
    ON verification_job(status);

CREATE INDEX IF NOT EXISTS idx__verification_job__person_id
    ON verification_job(person_id);

CREATE INDEX IF NOT EXISTS idx__verification_job__expires_at
    ON verification_job(expires_at);

CREATE INDEX IF NOT EXISTS idx__skipped__object_person_id__created_at__reported
    ON skipped(object_person_id, created_at)
    WHERE reported;

CREATE INDEX IF NOT EXISTS idx__skipped__object_person_id__subject_person_id
    ON skipped(object_person_id, subject_person_id);

CREATE INDEX IF NOT EXISTS idx__messaged__object_person_id__subject_person_id__created_at
    ON messaged(object_person_id, subject_person_id, created_at);

CREATE INDEX IF NOT EXISTS idx__messaged__object_person_id__created_at
    ON messaged(object_person_id, created_at);

CREATE INDEX IF NOT EXISTS idx__visited__object_person_id__updated_at
    ON visited(object_person_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx__visited__subject_person_id__updated_at
    ON visited(subject_person_id, updated_at DESC);

-- Serves the visitor-notification cron, which sweeps every recent visit rather
-- than looking one person up. Both person ids are in the index so the sweep
-- needn't touch the heap, and invisible visits are excluded because they never
-- reach the visitors tab and so are never notified about.
CREATE INDEX IF NOT EXISTS idx__visited__updated_at__object__subject
    ON visited(updated_at DESC, object_person_id, subject_person_id)
    WHERE NOT invisible;

CREATE INDEX IF NOT EXISTS idx__search_preference_age__person_id__bounds
    ON search_preference_age(person_id) INCLUDE (min_age, max_age);

CREATE INDEX IF NOT EXISTS idx__search_preference_distance__person_id__distance
    ON search_preference_distance(person_id) INCLUDE (distance);

CREATE INDEX IF NOT EXISTS idx__search_preference_height_cm__person_id__bounds
    ON search_preference_height_cm(person_id) INCLUDE (min_height_cm, max_height_cm);

CREATE INDEX IF NOT EXISTS
    idx__person__personality
    ON person
    USING hnsw (personality vector_ip_ops);


--------------------------------------------------------------------------------
-- DATA
--------------------------------------------------------------------------------

SELECT setval('verification_level_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM verification_level), FALSE);
INSERT INTO verification_level (name) VALUES ('No verification') ON CONFLICT (name) DO NOTHING;
INSERT INTO verification_level (name) VALUES ('Basics only') ON CONFLICT (name) DO NOTHING;
INSERT INTO verification_level (name) VALUES ('Photos') ON CONFLICT (name) DO NOTHING;

SELECT setval('gender_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM gender), FALSE);
INSERT INTO gender (name) VALUES ('Man') ON CONFLICT (name) DO NOTHING;
INSERT INTO gender (name) VALUES ('Woman') ON CONFLICT (name) DO NOTHING;
INSERT INTO gender (name) VALUES ('Agender') ON CONFLICT (name) DO NOTHING;
INSERT INTO gender (name) VALUES ('Femboy') ON CONFLICT (name) DO NOTHING;
INSERT INTO gender (name) VALUES ('Intersex') ON CONFLICT (name) DO NOTHING;
INSERT INTO gender (name) VALUES ('Non-binary') ON CONFLICT (name) DO NOTHING;
INSERT INTO gender (name) VALUES ('Transgender') ON CONFLICT (name) DO NOTHING;
INSERT INTO gender (name) VALUES ('Trans woman') ON CONFLICT (name) DO NOTHING;
INSERT INTO gender (name) VALUES ('Trans man') ON CONFLICT (name) DO NOTHING;
INSERT INTO gender (name) VALUES ('Other') ON CONFLICT (name) DO NOTHING;

SELECT setval('orientation_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM orientation), FALSE);
INSERT INTO orientation (name) VALUES ('Unanswered') ON CONFLICT (name) DO NOTHING;
INSERT INTO orientation (name) VALUES ('Straight') ON CONFLICT (name) DO NOTHING;
INSERT INTO orientation (name) VALUES ('Gay') ON CONFLICT (name) DO NOTHING;
INSERT INTO orientation (name) VALUES ('Lesbian') ON CONFLICT (name) DO NOTHING;
INSERT INTO orientation (name) VALUES ('Bisexual') ON CONFLICT (name) DO NOTHING;
INSERT INTO orientation (name) VALUES ('Asexual') ON CONFLICT (name) DO NOTHING;
INSERT INTO orientation (name) VALUES ('Demisexual') ON CONFLICT (name) DO NOTHING;
INSERT INTO orientation (name) VALUES ('Pansexual') ON CONFLICT (name) DO NOTHING;
INSERT INTO orientation (name) VALUES ('Queer') ON CONFLICT (name) DO NOTHING;
INSERT INTO orientation (name) VALUES ('Other') ON CONFLICT (name) DO NOTHING;

SELECT setval('ethnicity_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM ethnicity), FALSE);
INSERT INTO ethnicity (name) VALUES ('Unanswered') ON CONFLICT (name) DO NOTHING;
INSERT INTO ethnicity (name) VALUES ('Black/African Descent') ON CONFLICT (name) DO NOTHING;
INSERT INTO ethnicity (name) VALUES ('East Asian') ON CONFLICT (name) DO NOTHING;
INSERT INTO ethnicity (name) VALUES ('Hispanic/Latino') ON CONFLICT (name) DO NOTHING;
INSERT INTO ethnicity (name) VALUES ('Middle Eastern') ON CONFLICT (name) DO NOTHING;
INSERT INTO ethnicity (name) VALUES ('Native American') ON CONFLICT (name) DO NOTHING;
INSERT INTO ethnicity (name) VALUES ('Pacific Islander') ON CONFLICT (name) DO NOTHING;
INSERT INTO ethnicity (name) VALUES ('South Asian') ON CONFLICT (name) DO NOTHING;
INSERT INTO ethnicity (name) VALUES ('Southeast Asian') ON CONFLICT (name) DO NOTHING;
INSERT INTO ethnicity (name) VALUES ('White/Caucasian') ON CONFLICT (name) DO NOTHING;
INSERT INTO ethnicity (name) VALUES ('Other') ON CONFLICT (name) DO NOTHING;

SELECT setval('looking_for_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM looking_for), FALSE);
INSERT INTO looking_for (name) VALUES ('Unanswered') ON CONFLICT (name) DO NOTHING;
INSERT INTO looking_for (name) VALUES ('Friends') ON CONFLICT (name) DO NOTHING;
INSERT INTO looking_for (name) VALUES ('Short-term dating') ON CONFLICT (name) DO NOTHING;
INSERT INTO looking_for (name) VALUES ('Long-term dating') ON CONFLICT (name) DO NOTHING;
INSERT INTO looking_for (name) VALUES ('Marriage') ON CONFLICT (name) DO NOTHING;

SELECT setval('last_online_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM last_online), FALSE);
INSERT INTO last_online (name, seconds) VALUES ('Now', {{LAST_ONLINE_NOW_SECONDS}}) ON CONFLICT (name) DO NOTHING;
INSERT INTO last_online (name, seconds) VALUES ('A day ago', 86400) ON CONFLICT (name) DO NOTHING;
INSERT INTO last_online (name, seconds) VALUES ('A week ago', 604800) ON CONFLICT (name) DO NOTHING;
INSERT INTO last_online (name, seconds) VALUES ('{{LAST_ONLINE_DEFAULT_NAME}}', {{LAST_ONLINE_DEFAULT_SECONDS}}) ON CONFLICT (name) DO NOTHING;
INSERT INTO last_online (name, seconds) VALUES ('All time', 3153600000) ON CONFLICT (name) DO NOTHING;

SELECT setval('relationship_status_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM relationship_status), FALSE);
INSERT INTO relationship_status (name) VALUES ('Unanswered') ON CONFLICT (name) DO NOTHING;
INSERT INTO relationship_status (name) VALUES ('Single') ON CONFLICT (name) DO NOTHING;
INSERT INTO relationship_status (name) VALUES ('Seeing someone') ON CONFLICT (name) DO NOTHING;
INSERT INTO relationship_status (name) VALUES ('Engaged') ON CONFLICT (name) DO NOTHING;
INSERT INTO relationship_status (name) VALUES ('Married') ON CONFLICT (name) DO NOTHING;
INSERT INTO relationship_status (name) VALUES ('Divorced') ON CONFLICT (name) DO NOTHING;
INSERT INTO relationship_status (name) VALUES ('Widowed') ON CONFLICT (name) DO NOTHING;
INSERT INTO relationship_status (name) VALUES ('Other') ON CONFLICT (name) DO NOTHING;

SELECT setval('religion_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM religion), FALSE);
INSERT INTO religion (name) VALUES ('Unanswered') ON CONFLICT (name) DO NOTHING;
INSERT INTO religion (name) VALUES ('Agnostic') ON CONFLICT (name) DO NOTHING;
INSERT INTO religion (name) VALUES ('Atheist') ON CONFLICT (name) DO NOTHING;
INSERT INTO religion (name) VALUES ('Buddhist') ON CONFLICT (name) DO NOTHING;
INSERT INTO religion (name) VALUES ('Christian') ON CONFLICT (name) DO NOTHING;
INSERT INTO religion (name) VALUES ('Hindu') ON CONFLICT (name) DO NOTHING;
INSERT INTO religion (name) VALUES ('Jewish') ON CONFLICT (name) DO NOTHING;
INSERT INTO religion (name) VALUES ('Muslim') ON CONFLICT (name) DO NOTHING;
INSERT INTO religion (name) VALUES ('Zoroastrian') ON CONFLICT (name) DO NOTHING;
INSERT INTO religion (name) VALUES ('Other') ON CONFLICT (name) DO NOTHING;

SELECT setval('star_sign_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM star_sign), FALSE);
INSERT INTO star_sign (name) VALUES ('Unanswered') ON CONFLICT (name) DO NOTHING;
INSERT INTO star_sign (name) VALUES ('Aquarius') ON CONFLICT (name) DO NOTHING;
INSERT INTO star_sign (name) VALUES ('Aries') ON CONFLICT (name) DO NOTHING;
INSERT INTO star_sign (name) VALUES ('Cancer') ON CONFLICT (name) DO NOTHING;
INSERT INTO star_sign (name) VALUES ('Capricorn') ON CONFLICT (name) DO NOTHING;
INSERT INTO star_sign (name) VALUES ('Gemini') ON CONFLICT (name) DO NOTHING;
INSERT INTO star_sign (name) VALUES ('Leo') ON CONFLICT (name) DO NOTHING;
INSERT INTO star_sign (name) VALUES ('Libra') ON CONFLICT (name) DO NOTHING;
INSERT INTO star_sign (name) VALUES ('Pisces') ON CONFLICT (name) DO NOTHING;
INSERT INTO star_sign (name) VALUES ('Sagittarius') ON CONFLICT (name) DO NOTHING;
INSERT INTO star_sign (name) VALUES ('Scorpio') ON CONFLICT (name) DO NOTHING;
INSERT INTO star_sign (name) VALUES ('Taurus') ON CONFLICT (name) DO NOTHING;
INSERT INTO star_sign (name) VALUES ('Virgo') ON CONFLICT (name) DO NOTHING;

SELECT setval('unit_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM unit), FALSE);
INSERT INTO unit (name) VALUES ('Imperial') ON CONFLICT (name) DO NOTHING;
INSERT INTO unit (name) VALUES ('Metric') ON CONFLICT (name) DO NOTHING;

SELECT setval('immediacy_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM immediacy), FALSE);
INSERT INTO immediacy (name) VALUES ('Immediately') ON CONFLICT (name) DO NOTHING;
INSERT INTO immediacy (name) VALUES ('Daily') ON CONFLICT (name) DO NOTHING;
INSERT INTO immediacy (name) VALUES ('Every 3 days') ON CONFLICT (name) DO NOTHING;
INSERT INTO immediacy (name) VALUES ('Weekly') ON CONFLICT (name) DO NOTHING;
INSERT INTO immediacy (name) VALUES ('Never') ON CONFLICT (name) DO NOTHING;

SELECT setval('frequency_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM frequency), FALSE);
INSERT INTO frequency (name) VALUES ('Unanswered') ON CONFLICT (name) DO NOTHING;
INSERT INTO frequency (name) VALUES ('Often') ON CONFLICT (name) DO NOTHING;
INSERT INTO frequency (name) VALUES ('Sometimes') ON CONFLICT (name) DO NOTHING;
INSERT INTO frequency (name) VALUES ('Never') ON CONFLICT (name) DO NOTHING;

SELECT setval('yes_no_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM yes_no), FALSE);
INSERT INTO yes_no (name) VALUES ('Yes') ON CONFLICT (name) DO NOTHING;
INSERT INTO yes_no (name) VALUES ('No') ON CONFLICT (name) DO NOTHING;

SELECT setval('yes_country_only_no_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM yes_country_only_no), FALSE);
INSERT INTO yes_country_only_no (name) VALUES ('Yes') ON CONFLICT (name) DO NOTHING;
INSERT INTO yes_country_only_no (name) VALUES ('Country only') ON CONFLICT (name) DO NOTHING;
INSERT INTO yes_country_only_no (name) VALUES ('No') ON CONFLICT (name) DO NOTHING;

SELECT setval('yes_no_optional_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM yes_no_optional), FALSE);
INSERT INTO yes_no_optional (name) VALUES ('Unanswered') ON CONFLICT (name) DO NOTHING;
INSERT INTO yes_no_optional (name) VALUES ('Yes') ON CONFLICT (name) DO NOTHING;
INSERT INTO yes_no_optional (name) VALUES ('No') ON CONFLICT (name) DO NOTHING;

SELECT setval('yes_no_maybe_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM yes_no_maybe), FALSE);
INSERT INTO yes_no_maybe (name) VALUES ('Unanswered') ON CONFLICT (name) DO NOTHING;
INSERT INTO yes_no_maybe (name) VALUES ('Yes') ON CONFLICT (name) DO NOTHING;
INSERT INTO yes_no_maybe (name) VALUES ('No') ON CONFLICT (name) DO NOTHING;
INSERT INTO yes_no_maybe (name) VALUES ('Maybe') ON CONFLICT (name) DO NOTHING;

SELECT setval('trait_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM trait), FALSE);
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Agreeableness',
    'Captures an individual''s range of social behaviors, from demonstrating empathy, cooperation, and consideration for others to expressing assertiveness and independence in social situations.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Anxious Attachment',
    'Measures the extent to which a person seeks reassurance and fears abandonment in close relationships. If a person scores low on this and the "Avoidant Attachment" scale, they''re said to be "securely" attached. Secure attachment is associated with longer, more stable relationships.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Avoidant Attachment',
    'Measures the preference for emotional distance and self-reliance in relationships. If a person scores low on this and the "Anxious Attachment" scale, they''re said to be "securely" attached. Secure attachment is associated with longer, more stable relationships.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Conscientiousness',
    'Represents an individual''s approach to organization, reliability, and goal-setting, encompassing both highly structured and responsible behavior as well as a more flexible and spontaneous approach.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Neuroticism',
    'Depicts the diversity in how people experience and cope with emotions, spanning the range from calmness and emotional steadiness to sensitivity and emotional responsiveness.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Career Focus',
    'This trait reflects the importance you place on your career. Those scoring high value their career and tend to prioritize it, while those scoring low might prioritize other aspects of life over their career.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Drug Friendliness',
    'This trait measures your openness to drug use. High scores could indicate a liberal attitude towards drugs or personal use, while low scores may represent a more conservative view or no personal use of drugs.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Emotional Openness in Relationships',
    'This trait measures how comfortable you are with expressing emotions in a relationship. High scores mean you are open to discussing your feelings, while low scores might indicate a more reserved emotional style.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Empathy',
    'This trait indicates how well you understand and share the feelings of others. High empathy means you easily connect with others'' emotions, while low empathy might indicate a more logical, detached approach.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Emphasis on Boundaries',
    'This trait signifies a person''s tendency to define, communicate, and respect personal limits and spaces. People who score high on this trait believe in the importance of setting clear personal boundaries in their relationships.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Environmentalism/Anthropocentrism',
    'Measures prioritization of preserving the environment and non-human species versus human-centered resource utilization and economic development.',
    'Environmentalism',
    'Anthropocentrism'
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Equanimity',
    'This trait pertains to a person''s ability to maintain calm and composure, especially during stressful situations. Individuals who score high on this trait are able to keep their cool and think clearly, regardless of the circumstances.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Equity/Meritocracy',
    'Measures a person''s preference for a system that rewards individuals based on their abilities and achievements versus a system that prioritizes fairness and equal opportunities for everyone.',
    'Equity',
    'Meritocracy'
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Family Focus',
    'This trait is about how much a person values family relationships and commitments. Individuals who score high on this trait often place their family as a top priority and enjoy spending quality time with their loved ones.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Fitness Focus',
    'This trait indicates the importance a person places on maintaining physical fitness and living a healthy lifestyle. Those with high scores for this trait are likely to enjoy activities like regular exercise, eating balanced meals, and living an overall active lifestyle.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Honesty',
    'This trait describes a person''s tendency to speak the truth, behave transparently, and avoid deception. Individuals who score high on this trait value truthfulness and believe in being straightforward in their communications.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Humility',
    'This trait reflects a person''s ability to remain modest and unpretentious, even in the face of success. Those who score high on this trait believe in acknowledging the role of others in their achievements and avoiding arrogance.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Independence',
    'Do you take charge of your own life and make decisions without leaning on others? This trait measures your self-reliance and ability to handle things on your own.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Individualism/Collectivism',
    'This trait measures a person''s preference for individual rights and freedoms versus collective good and social cohesion.',
    'Individualism',
    'Collectivism'
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Introversion/Extraversion',
    'Measures a person''s preference for engaging with the world, ranging from drawing energy from social interactions and being action-oriented (Extraversion) to finding energy in solitude and focusing on thoughts and feelings (Introversion).',
    'Introversion',
    'Extraversion'
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Isolationism/Internationalism',
    'This trait measures preference for national self-reliance and limited global engagement versus active participation in international affairs and cooperation.',
    'Isolationism',
    'Internationalism'
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Judging/Perceiving',
    'This trait captures someone''s approach to organizing and structuring their life, ranging from preferring a planned, orderly, and decisive lifestyle (Judging), to embracing spontaneity, flexibility, and adaptability (Perceiving).',
    'Judging',
    'Perceiving'
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Libertarianism/Authoritarianism',
    'This trait measures the preference for individual liberties and minimal government intervention, versus strong central authority and extensive government control.',
    'Libertarianism',
    'Authoritarianism'
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Love Focus',
    'How central is love in your life? This trait captures the importance you place on romantic relationships and the effort you''re willing to put into finding and maintaining them.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Loyalty',
    'This trait shows us how committed you are. When you make a promise, do you keep it?',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Maturity',
    'A measure of how much a person takes responsibility for their actions, understands the world around them, and is ready to deal with complex issues. It is not about age, but about mindset and experience.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Non-interventionism/Interventionism',
    'Measures a person''s preference for an active foreign policy with military and diplomatic interventions versus a non-interventionist approach that emphasizes diplomacy and trade.',
    'Non-interventionism',
    'Interventionism'
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Openness to Experience',
    'Represents a person''s willingness to explore new ideas, activities, and experiences. People high in this trait tend to be imaginative, creative, and curious. Those lower might appreciate routine, predictability, and familiar surroundings.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Patience',
    'Measures your ability to stay calm and tolerant when facing challenges.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Persistence',
    'Indicates how much you''re willing to stick with tasks, goals or beliefs, even in the face of adversity. Those lower in this trait might be more flexible, adaptive, and ready to pivot when needed.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Playfulness',
    'This trait measures your tendency to seek joy, humor, and fun in life. High scores often enjoy spontaneity, games, and laughter. Those scoring lower might appreciate seriousness, focus, and quiet reflection.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Preference for Monogamy',
    'This trait measures your inclination towards having one partner at a time. A low score doesn''t necessarily mean a preference for multiple partners simultaneously, but might reflect a desire for serial monogamy, or simply being open to different relationship structures.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Rationality',
    'This trait determines the extent to which you prefer using logical reasoning and objective analysis over emotional intuition. Both approaches have their advantages, and neither is inherently better or worse than the other.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Religiosity',
    'This trait measures the extent to which religious beliefs influence your life. It doesn''t indicate which religion you follow, or how devout you are, just the importance religion holds for you. It includes both traditionally religious and spiritual orientations.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Security/Freedom',
    'Measures how much a person values national security and public safety versus individual freedoms and civil liberties.',
    'Security',
    'Freedom'
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Self-acceptance',
    'This trait measures your level of acceptance and appreciation for who you are as an individual. It doesn''t mean being complacent or avoiding personal growth, but rather denotes a healthy self-perception and an acceptance of one''s strengths and weaknesses.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Self-esteem',
    'This trait signifies your overall subjective emotional evaluation of your own worth. High self-esteem doesn''t mean arrogance but refers to a positive, balanced view of oneself. Low self-esteem doesn''t necessarily indicate lack of confidence but may reflect humility or a more critical self-view.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Sensing/Intuition',
    'This trait represents someone''s preferred way of processing information, covering the spectrum from focusing on concrete, tangible details and experiences (Sensing), to exploring abstract concepts, patterns, and possibilities (Intuition).',
    'Sensing',
    'Intuition'
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Sex Focus',
    'This trait measures how much a person prioritises sex over love',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Stability of Self-image',
    'This trait assesses how consistent a person''s self-perception is. If you score high, you typically have a strong and steady sense of who you are, while a low score indicates that your self-image may change based on circumstances, moods, or new experiences.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Thinking/Feeling',
    'This trait reflects a person''s decision-making style, encompassing both logical, objective analysis and rationality (Thinking), as well as empathy, values, and consideration for others'' emotions (Feeling).',
    'Thinking',
    'Feeling'
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Thriftiness',
    'This trait reflects how careful you are with your resources, especially financial ones. High scorers tend to be frugal and prioritize saving, while low scorers may be more inclined to spend on experiences or items that bring them joy or satisfaction.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Thrill-seeking',
    'This trait measures a person''s desire for excitement and adventure. If you score high, you''re likely to enjoy taking risks and exploring new experiences. A lower score indicates a preference for routine, comfort, and safety.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Traditionalism about Love',
    'This trait gauges how much a person values traditional beliefs and practices about love and relationships. A high score indicates a preference for traditional courtship and relationship roles, while a low score might suggest an openness to modern or non-traditional expressions of love.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Trust',
    'This trait represents a person''s propensity to trust others. A high scorer generally assumes that people are well-intentioned and reliable, while a low scorer tends to be more cautious and requires more evidence to trust others.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;
INSERT INTO trait (name, description, min_label, max_label) VALUES (
    'Wholesomeness',
    'This trait measures a person''s inclination towards innocence, kindness, and a general appreciation for the simple things in life. High scorers are typically viewed as pure-hearted and genuine.',
    NULL,
    NULL
) ON CONFLICT (name) DO NOTHING;



INSERT INTO trait_topic (trait_id, name)
SELECT id, 'MBTI' FROM trait WHERE name = 'Introversion/Extraversion'
ON CONFLICT DO NOTHING;

INSERT INTO trait_topic (trait_id, name)
SELECT id, 'MBTI' FROM trait WHERE name = 'Thinking/Feeling'
ON CONFLICT DO NOTHING;

INSERT INTO trait_topic (trait_id, name)
SELECT id, 'MBTI' FROM trait WHERE name = 'Sensing/Intuition'
ON CONFLICT DO NOTHING;

INSERT INTO trait_topic (trait_id, name)
SELECT id, 'MBTI' FROM trait WHERE name = 'Judging/Perceiving'
ON CONFLICT DO NOTHING;



INSERT INTO trait_topic (trait_id, name)
SELECT id, 'Big 5' FROM trait WHERE name = 'Openness to Experience'
ON CONFLICT DO NOTHING;

INSERT INTO trait_topic (trait_id, name)
SELECT id, 'Big 5' FROM trait WHERE name = 'Conscientiousness'
ON CONFLICT DO NOTHING;

INSERT INTO trait_topic (trait_id, name)
SELECT id, 'Big 5' FROM trait WHERE name = 'Introversion/Extraversion'
ON CONFLICT DO NOTHING;

INSERT INTO trait_topic (trait_id, name)
SELECT id, 'Big 5' FROM trait WHERE name = 'Agreeableness'
ON CONFLICT DO NOTHING;

INSERT INTO trait_topic (trait_id, name)
SELECT id, 'Big 5' FROM trait WHERE name = 'Neuroticism'
ON CONFLICT DO NOTHING;



INSERT INTO trait_topic (trait_id, name)
SELECT id, 'Attachment Style' FROM trait WHERE name = 'Anxious Attachment'
ON CONFLICT DO NOTHING;

INSERT INTO trait_topic (trait_id, name)
SELECT id, 'Attachment Style' FROM trait WHERE name = 'Avoidant Attachment'
ON CONFLICT DO NOTHING;



INSERT INTO trait_topic (trait_id, name)
SELECT id, 'Politics' FROM trait WHERE name = 'Individualism/Collectivism'
ON CONFLICT DO NOTHING;

INSERT INTO trait_topic (trait_id, name)
SELECT id, 'Politics' FROM trait WHERE name = 'Libertarianism/Authoritarianism'
ON CONFLICT DO NOTHING;

INSERT INTO trait_topic (trait_id, name)
SELECT id, 'Politics' FROM trait WHERE name = 'Environmentalism/Anthropocentrism'
ON CONFLICT DO NOTHING;

INSERT INTO trait_topic (trait_id, name)
SELECT id, 'Politics' FROM trait WHERE name = 'Isolationism/Internationalism'
ON CONFLICT DO NOTHING;

INSERT INTO trait_topic (trait_id, name)
SELECT id, 'Politics' FROM trait WHERE name = 'Security/Freedom'
ON CONFLICT DO NOTHING;

INSERT INTO trait_topic (trait_id, name)
SELECT id, 'Politics' FROM trait WHERE name = 'Non-interventionism/Interventionism'
ON CONFLICT DO NOTHING;

INSERT INTO trait_topic (trait_id, name)
SELECT id, 'Politics' FROM trait WHERE name = 'Equity/Meritocracy'
ON CONFLICT DO NOTHING;



INSERT INTO trait_topic
SELECT
    trait.id,
    'Other'
FROM
    trait
WHERE
    id NOT IN (
        SELECT
            trait_id
        FROM
            trait_topic
        WHERE
            name IN ('MBTI', 'Big 5', 'Attachment', 'Politics')
    )
ON CONFLICT DO NOTHING;

INSERT INTO funding (id, estimated_end_date, cost_per_month_usd)
VALUES (1, now() + interval '1 year', 360.0)
ON CONFLICT (id) DO NOTHING;

--------------------------------------------------------------------------------
-- FUNCTIONS (2)
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trait_ratio(
    presence_score INT[],
    absence_score INT[],
    score_threshold INT
)
RETURNS TABLE(trait_id SMALLINT, ratio FLOAT4) AS $$
    SELECT
        ROW_NUMBER() OVER() AS trait_id,
        CASE
            WHEN (a + b) >= GREATEST(1, score_threshold)
            THEN a::FLOAT4 / (a + b)
            ELSE NULL
        END AS percentage
    FROM UNNEST(presence_score, absence_score) as t(a, b);
$$ LANGUAGE sql IMMUTABLE LEAKPROOF PARALLEL SAFE;

--------------------------------------------------------------------------------
-- TRIGGER - refresh_has_profile_picture_id
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION refresh_has_profile_picture_id(p_person_id INT)
RETURNS INTEGER AS $$
    WITH has_photo AS (
        SELECT EXISTS (
            SELECT 1 FROM photo WHERE photo.person_id = p_person_id
        ) AS has_photo
    ), has_profile_picture_id AS (
        SELECT id
        FROM yes_no
        WHERE
            (name = 'Yes' AND (SELECT has_photo FROM has_photo))
        OR
            (name = 'No'  AND (SELECT NOT has_photo FROM has_photo))
    ), update_person AS (
        UPDATE person
        SET has_profile_picture_id = has_profile_picture_id.id
        FROM has_profile_picture_id
        WHERE person.id = p_person_id
        RETURNING 1
    )
    SELECT COUNT(*) FROM update_person;
$$ LANGUAGE sql;

CREATE OR REPLACE FUNCTION trigger_fn_refresh_has_profile_picture_id()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM refresh_has_profile_picture_id(NEW.person_id);
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM refresh_has_profile_picture_id(OLD.person_id);
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER
    trigger_refresh_has_profile_picture_id
AFTER INSERT OR DELETE ON
    photo
FOR EACH ROW
EXECUTE FUNCTION
    trigger_fn_refresh_has_profile_picture_id();

--------------------------------------------------------------------------------
-- TRIGGER - Copy `person` columns to `person_club`
--
-- This is used to speed up searches within clubs
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION
    copy_person_to_person_club()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.activated IS DISTINCT FROM NEW.activated THEN
        UPDATE person_club
        SET activated = NEW.activated
        WHERE person_id = NEW.id;
    END IF;

    IF OLD.coordinates IS DISTINCT FROM NEW.coordinates THEN
        UPDATE person_club
        SET coordinates = NEW.coordinates
        WHERE person_id = NEW.id;
    END IF;

    IF OLD.gender_id IS DISTINCT FROM NEW.gender_id THEN
        UPDATE person_club
        SET gender_id = NEW.gender_id
        WHERE person_id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER
    trigger_copy_person_to_person_club
AFTER UPDATE ON
    person
FOR EACH ROW
EXECUTE FUNCTION
    copy_person_to_person_club();

CREATE OR REPLACE FUNCTION
    populate_person_club_defaults()
RETURNS TRIGGER AS $$
BEGIN
    SELECT
        activated,
        coordinates,
        gender_id
    INTO
        NEW.activated,
        NEW.coordinates,
        NEW.gender_id
    FROM
        person
    WHERE
        id = NEW.person_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER
    trigger_populate_person_club_defaults
BEFORE INSERT ON
    person_club
FOR EACH ROW EXECUTE FUNCTION
    populate_person_club_defaults();

-- Marks a club dirty on join, leave/cascaded deletion, or activation
-- flip. Answer edits and joins/leaves that don't change `activated` are
-- left to the cron's max-age fallback, to keep write amplification bounded.
CREATE OR REPLACE FUNCTION
    mark_club_stats_dirty()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO club_stats_dirty (club_name)
        SELECT OLD.club_name
        WHERE EXISTS (SELECT 1 FROM club WHERE name = OLD.club_name)
        ON CONFLICT DO NOTHING;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.activated IS DISTINCT FROM NEW.activated THEN
            INSERT INTO club_stats_dirty (club_name) VALUES (NEW.club_name)
            ON CONFLICT DO NOTHING;
        END IF;
        RETURN NEW;
    ELSE
        INSERT INTO club_stats_dirty (club_name) VALUES (NEW.club_name)
        ON CONFLICT DO NOTHING;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER
    trigger_mark_club_stats_dirty
AFTER INSERT OR DELETE OR UPDATE OF activated ON
    person_club
FOR EACH ROW EXECUTE FUNCTION
    mark_club_stats_dirty();


--------------------------------------------------------------------------------
-- CHAT-RELATED TABLES
--
-- Much of this DDL comes from:
--
-- https://github.com/esl/MongooseIM/blob/abdcd0b48/priv/pg.sql
--
-- Many improvements can be made to better integrate these tables with the rest
-- of the app.
--------------------------------------------------------------------------------

DO $$ BEGIN
CREATE TYPE mam_direction AS ENUM('I','O');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS mam_message(
  -- Message UID (64 bits)
  -- A server-assigned UID that MUST be unique within the archive.
  id BIGINT NOT NULL,
  -- FromJID used to form a message without looking into stanza.
  -- This value will be send to the client "as is".
  from_jid varchar(250) NOT NULL,
  -- The remote JID that the stanza is to (for an outgoing message) or from (for an incoming message).
  -- This field is for sorting and filtering.
  remote_bare_jid varchar(250) NOT NULL,
  -- I - incoming, remote_jid is a value from From.
  -- O - outgoing, remote_jid is a value from To.
  -- Has no meaning for MUC-rooms.
  direction mam_direction NOT NULL,
  person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
  audio_uuid TEXT,
  -- The message's plain-text body.
  body TEXT NOT NULL,
  -- The stanza's XMPP `id` attribute.
  stanza_id TEXT NOT NULL,
  reaction TEXT,
  question_id SMALLINT,
  PRIMARY KEY(person_id, id)
);

CREATE INDEX IF NOT EXISTS idx__mam_message__person_id__remote_bare_jid__id
    ON mam_message
    (person_id, remote_bare_jid, id);

CREATE INDEX IF NOT EXISTS idx__mam_message__audio_uuid
    ON mam_message
    (audio_uuid);

CREATE TABLE IF NOT EXISTS inbox (
    luser VARCHAR(250)               NOT NULL,
    remote_bare_jid VARCHAR(250)     NOT NULL,
    msg_id VARCHAR(250),
    box VARCHAR(64)                  NOT NULL DEFAULT 'inbox',
    timestamp BIGINT                 NOT NULL,
    unread_count INT                 NOT NULL,
    displayed_at TIMESTAMP,
    body TEXT                        NOT NULL,
    -- Direction of the last message, mirroring `mam_message.direction`:
    --   I - incoming, remote_bare_jid is a value from From.
    --   O - outgoing, remote_bare_jid is a value from To.
    direction mam_direction          NOT NULL,
    -- The conversation's live reaction; NULL when the last activity is a message.
    reaction TEXT,
    reaction_target_mam_id BIGINT,
    reaction_body TEXT,
    PRIMARY KEY(luser, remote_bare_jid)
);

-- Used to time notifications appropriately
CREATE TABLE IF NOT EXISTS presence_histogram (
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    dow SMALLINT NOT NULL, -- 0=Sun .. 6=Sat
    hour SMALLINT NOT NULL, -- 0 .. 23 (UTC)
    score FLOAT4 NOT NULL,
    updated_at TIMESTAMP NOT NULL,

    PRIMARY KEY (person_id, dow, hour)
);

CREATE INDEX IF NOT EXISTS
    idx__inbox__luser__timestamp
    ON inbox(luser, timestamp);

CREATE INDEX IF NOT EXISTS
    idx__inbox__luser__box
    ON inbox(luser, box);

CREATE TABLE IF NOT EXISTS intro_hash (
    hash TEXT PRIMARY KEY,
    used_count BIGINT NOT NULL DEFAULT 1,
    last_used_at TIMESTAMP NOT NULL DEFAULT now()
);

-- TODO: Drop this table
CREATE TABLE IF NOT EXISTS rude_message (
    person_id INT REFERENCES person(id) ON DELETE CASCADE ON UPDATE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    message TEXT NOT NULL,

    PRIMARY KEY (person_id, created_at)
);

CREATE INDEX IF NOT EXISTS duo_idx__inbox__timestamp__luser__box
ON inbox(timestamp, luser, box)
WHERE unread_count > 0;

CREATE INDEX IF NOT EXISTS duo_idx__mam_message__remote_bare_jid__id
ON mam_message(remote_bare_jid, id)
WHERE direction = 'I';

CREATE INDEX IF NOT EXISTS
    idx__inbox__luser__timestamp
    ON inbox(luser, timestamp);

CREATE INDEX IF NOT EXISTS
    idx__inbox__luser__box
    ON inbox(luser, box);

CREATE INDEX IF NOT EXISTS idx__person__last_online_time
    ON person(last_online_time);

CREATE INDEX IF NOT EXISTS idx__person__came_online_time
    ON person(came_online_time);
