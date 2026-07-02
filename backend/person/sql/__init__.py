import constants
from constants import MIN_CLUB_PAGE_MEMBERS, MAX_RELATED_CLUBS
from commonsql import Q_IS_ALLOWED_CLUB_NAME, Q_COMPUTED_FLAIR

MAX_CLUB_SEARCH_RESULTS = 20

CLUB_QUOTA_GOLD = 100
CLUB_QUOTA_FREE = 50

# How often the user should be nagged to donate, in days. The frequency
# increases as funds run out.
_Q_DONATION_NAG_FREQUENCY = """
SELECT
    make_interval(
        days => greatest(2, estimated_end_date::date - NOW()::date) / 2
    )
FROM
    funding
"""

_Q_DO_SHOW_DONATION_NAG = f"""
(
        {{table}}.last_nag_time < NOW() - ({_Q_DONATION_NAG_FREQUENCY})
    AND
        {{table}}.sign_up_time < NOW() - ({_Q_DONATION_NAG_FREQUENCY})
    AND
        {{table}}.count_answers >= 25
) AS do_show_donation_nag
"""

_Q_ESTIMATED_END_DATE = """
(SELECT iso8601_utc(estimated_end_date) FROM funding) AS estimated_end_date
"""

Q_SELECT_PERSONALITY = """
SELECT
    CASE
        WHEN %(topic)s::TEXT = 'Big 5' AND trait.name = 'Introversion/Extraversion'
        THEN 'Extraversion'
        ELSE trait.name
    END                               AS trait_name,
    CASE
        WHEN %(topic)s::TEXT = 'Big 5' AND trait.name = 'Introversion/Extraversion'
        THEN NULL
        ELSE trait.min_label
    END                               AS trait_min_label,
    CASE
        WHEN %(topic)s::TEXT = 'Big 5' AND trait.name = 'Introversion/Extraversion'
        THEN NULL
        ELSE trait.max_label
    END                               AS trait_max_label,
    trait.description                 AS trait_description,
    person_trait.name                 AS person_name,
    person_trait.tiny_id              AS person_id,
    ROUND(100 * person_trait.ratio)   AS person_percentage,
    prospect_trait.name               AS prospect_name,
    ROUND(100 * prospect_trait.ratio) AS prospect_percentage,
    CASE
        WHEN %(prospect_person_id)s IS NOT NULL
        THEN COALESCE(prospect_trait.ratio, 0)
        ELSE COALESCE(person_trait.ratio, 0)
    END AS position
FROM
    trait
LEFT JOIN
    (
        SELECT
            id,
            tiny_id,
            name,
            (trait_ratio(presence_score, absence_score, 5000)).*
        FROM
            person
        WHERE
            id = %(person_id_as_int)s::INT
        OR
            tiny_id = %(person_id_as_str)s::TEXT
    ) AS person_trait
ON
    person_trait.trait_id = trait.id
LEFT JOIN
    (
        SELECT
            id,
            name,
            (trait_ratio(presence_score, absence_score, 5000)).*
        FROM person
        WHERE id = %(prospect_person_id)s
    ) AS prospect_trait
ON
    prospect_trait.trait_id = trait.id
WHERE
    trait.id IN (
        SELECT trait_id
        FROM trait_topic
        WHERE
            trait_topic.name = %(topic)s OR
            %(topic)s::TEXT IS NULL
    )
ORDER BY
    position DESC,
    trait_name ASC
"""

# Reactivation/sign-in metadata bumps shared by `/check-otp` and the
# social sign-in flow: marks the user activated, bumps `sign_in_count` /
# `sign_in_time`, and (only when the user was previously deactivated)
# increments their clubs' `count_members`.
#
# Caller must define `existing_person_before_update` first as a CTE
# yielding `(id, activated)` with zero or one rows — that anchor lets the
# club-count branch read the user's *pre-update* activated state.
_Q_POST_SIGN_IN_CTES = """
existing_person AS (
    UPDATE
        person
    SET
        activated = TRUE,
        sign_in_count = sign_in_count + 1,
        sign_in_time = NOW()
    WHERE
        id = (SELECT id FROM existing_person_before_update)
    RETURNING
        person.id,
        person.uuid AS person_uuid,
        person.unit_id,
        person.name,
        person.last_nag_time,
        person.sign_up_time,
        person.count_answers,
        person.has_gold
), club_to_increment AS (
    SELECT
        person_club.club_name
    FROM
        existing_person
    LEFT JOIN
        person_club
    ON
        person_club.person_id = existing_person.id
    JOIN
        existing_person_before_update
    ON
        existing_person_before_update.id = existing_person.id
    WHERE
        NOT existing_person_before_update.activated
), increment_club_count_if_not_activated AS (
    UPDATE
        club
    SET
        count_members = count_members + 1
    FROM
        club_to_increment
    WHERE
        club_to_increment.club_name = club.name
)
"""

# OTP-issuing CTE chain. The ban check is intentionally NOT here: the
# OTP and social paths share `Q_IS_BANNED` for that and run it as an
# explicit step in the same transaction, which keeps both endpoints
# following the same control flow.
_OTP_CTE = """
WITH random_otp AS (
    SELECT LPAD(FLOOR(RANDOM() * (10e5 + 1))::TEXT, 6, '0') AS otp
), zero_otp AS (
    SELECT '000000' AS otp
), is_registered AS (
    SELECT 1 WHERE     EXISTS (SELECT 1 FROM person WHERE normalized_email = %(normalized_email)s)
), is_unregistered AS (
    SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM person WHERE normalized_email = %(normalized_email)s)
), domain AS (
    SELECT
        SUBSTRING(%(email)s FROM POSITION('@' IN %(email)s) + 1) AS domain
), otp AS (
    SELECT
        CASE
        WHEN
                EXISTS (SELECT 1 FROM domain WHERE domain = 'example.com')
            AND
                EXISTS (SELECT 1 FROM is_registered)
            OR
                EXISTS (SELECT 1 FROM domain WHERE domain = 'example.com')
            AND
                %(is_dev)s
        THEN
            (SELECT otp FROM zero_otp)
        ELSE
            (SELECT otp FROM random_otp)
        END AS otp
    WHERE
        NOT EXISTS (
            SELECT
                1
            FROM
                bad_email_domain
            JOIN
                domain
            ON
                domain.domain = bad_email_domain.domain
            JOIN
                is_unregistered
            ON
                TRUE
        )
)
"""

Q_INSERT_DUO_SESSION = f"""
{_OTP_CTE}
INSERT INTO duo_session (
    session_token_hash,
    person_id,
    email,
    pending_club_name,
    otp,
    ip_address,
    answers
)
SELECT
    %(session_token_hash)s,
    (
        SELECT
            id
        FROM
            person
        WHERE
            normalized_email = %(normalized_email)s
        ORDER BY
            email = %(email)s DESC,
            email
        LIMIT 1
    ),
    %(email)s,
    %(pending_club_name)s,
    otp,
    %(ip_address)s,
    %(answers)s::jsonb
FROM
    otp
RETURNING
    otp
"""

Q_UPDATE_OTP = f"""
{_OTP_CTE}
UPDATE
    duo_session
SET
    otp = otp.otp,
    otp_expiry = NOW() + INTERVAL '10 minutes'
FROM
    otp
WHERE
    session_token_hash = %(session_token_hash)s
RETURNING
    otp.otp
"""

Q_MAYBE_DELETE_ONBOARDEE = """
WITH valid_session AS (
    UPDATE duo_session
    SET signed_in = TRUE
    WHERE
        session_token_hash = %(session_token_hash)s AND
        otp = %(otp)s AND
        otp_expiry > NOW()
    RETURNING email
)
DELETE FROM onboardee
WHERE email IN (SELECT email FROM valid_session)
RETURNING email
"""

Q_MAYBE_SIGN_IN = f"""
WITH valid_session AS (
    UPDATE
        duo_session
    SET
        signed_in = TRUE
    WHERE
        session_token_hash = %(session_token_hash)s
    AND
        otp = %(otp)s
    AND
        otp_expiry > NOW()
    AND NOT EXISTS (
        SELECT
            1
        FROM
            person
        WHERE
            person.id = duo_session.person_id
        AND
            'bot' = ANY(person.roles)
    )
    RETURNING
        person_id,
        email
), existing_person_before_update AS (
    SELECT
        id,
        activated
    FROM
        person
    WHERE
        id = (SELECT person_id FROM valid_session)
), {_Q_POST_SIGN_IN_CTES}, new_onboardee AS (
    INSERT INTO onboardee (
        email
    )
    SELECT
        email
    FROM
        valid_session
    WHERE NOT EXISTS (SELECT 1 FROM existing_person)
)
SELECT
    person_id,
    person_uuid,
    has_gold,
    (SELECT name FROM unit WHERE id = existing_person.unit_id) AS units,
    {_Q_DO_SHOW_DONATION_NAG.format(table='existing_person')},
    {_Q_ESTIMATED_END_DATE},
    existing_person.name AS name
FROM
    valid_session
LEFT JOIN
    existing_person
ON
    valid_session.person_id = existing_person.id
"""

Q_FINISH_ONBOARDING = f"""
WITH onboardee_location AS (
    SELECT
        short_friendly,
        long_friendly,
        country,
        verification_required
    FROM
        location
    ORDER BY coordinates <-> (
        SELECT coordinates
        FROM onboardee
        WHERE email = %(email)s
    )
    LIMIT 1
), new_person AS (
    INSERT INTO person (
        email,
        normalized_email,
        name,
        url_slug,
        date_of_birth,
        coordinates,
        gender_id,
        about,
        has_profile_picture_id,
        unit_id,
        intros_notification,
        verification_required,
        location_short_friendly,
        location_long_friendly
    ) SELECT
        email,
        %(normalized_email)s,
        name,
        url_slug,
        date_of_birth,
        coordinates,
        gender_id,
        COALESCE(about, ''),
        CASE
            WHEN EXISTS (SELECT 1 FROM onboardee_photo WHERE email = %(email)s)
            THEN 1
            ELSE 2
        END AS has_profile_picture_id,
        (
            SELECT id
            FROM unit
            WHERE name IN (
                CASE
                    WHEN country IN ('United States', 'United Kingdom')
                    THEN 'Imperial'
                    ELSE 'Metric'
                END
            )
        ) AS unit_id,
        2 AS intros_notification,
        verification_required,
        short_friendly,
        long_friendly
    FROM
        onboardee,
        onboardee_location
    WHERE email = %(email)s
    RETURNING
        id,
        person.uuid,
        url_slug,
        email,
        unit_id,
        coordinates,
        date_of_birth,
        person.name
), best_age AS (
    WITH new_person_age AS (
        SELECT
            EXTRACT(YEAR FROM AGE(date_of_birth)) AS age
        FROM
            new_person
    ), unbounded_age_preference AS (
        SELECT
            round(age - 2 - (age - 18) / 5.0) AS min_age,
            round(age + 2 + (age - 18) / 5.0) AS max_age
        FROM
            new_person_age
    )
    SELECT
        CASE WHEN min_age <= 18 THEN NULL ELSE min_age END AS min_age,
        CASE WHEN max_age >= 99 THEN NULL ELSE max_age END AS max_age
    FROM
        unbounded_age_preference
), best_distance AS (
    -- Use a binary search to compute the "furthest distance" search preference
    -- which causes search results to contain as close as possible to 2000 users
    WITH RECURSIVE t(dist, cnt, iters) AS (
        VALUES
            (    0.0,    0.0, 0),
            (10000.0,  1.0e9, 0)
        UNION ALL (
            WITH two_closest AS (
                SELECT
                    dist,
                    cnt,
                    iters
                FROM
                    t
                ORDER BY
                    iters DESC,
                    ABS(cnt - 2000),
                    dist
                LIMIT 2
            ), midpoint AS (
                SELECT
                    AVG(dist) AS dist,
                    MAX(iters) AS iters
                FROM
                    two_closest
            ), limited_search_results AS (
                SELECT
                    midpoint.dist AS dist,
                    midpoint.iters AS iters
                FROM
                    person AS prospect, midpoint
                WHERE
                    activated
                AND
                    -- The prospect meets the new_person's gender preference
                    prospect.gender_id IN (
                        SELECT gender_id
                        FROM onboardee_search_preference_gender AS preference
                        WHERE preference.email = (SELECT email FROM new_person)
                    )
                AND
                    -- The prospect meets the new_person's location preference
                    ST_DWithin(
                        prospect.coordinates,
                        (SELECT coordinates FROM new_person),
                        midpoint.dist * 1000
                    )
                AND
                    -- The new_person meets the prospect's gender preference
                    EXISTS (
                        SELECT 1
                        FROM search_preference_gender AS preference
                        WHERE
                            preference.person_id = prospect.id AND
                            preference.gender_id = (SELECT gender_id FROM new_person)
                    )
                AND
                    -- The new_person meets the prospect's location preference
                    ST_DWithin(
                        prospect.coordinates,
                        (SELECT coordinates FROM new_person),
                        (
                            SELECT
                                COALESCE(
                                    (
                                        SELECT
                                            1000 * distance
                                        FROM
                                            person
                                        JOIN
                                            search_preference_distance
                                        ON
                                            person.id = person_id
                                        WHERE
                                            person.id = prospect.id
                                    ),
                                    1e9
                                )
                        )
                    )
                AND
                   -- The prospect meets the new_person's age preference
                   EXISTS (
                        SELECT 1
                        FROM best_age AS preference
                        WHERE
                            prospect.date_of_birth <= (
                                CURRENT_DATE -
                                INTERVAL '1 year' *
                                COALESCE(preference.min_age, 0)
                            )
                        AND
                            prospect.date_of_birth > (
                                CURRENT_DATE -
                                INTERVAL '1 year' *
                                (COALESCE(preference.max_age, 999) + 1)
                            )
                    )
                AND
                   -- The new_person meets the prospect's age preference
                   EXISTS (
                        SELECT 1
                        FROM search_preference_age AS preference
                        WHERE
                            preference.person_id = prospect.id
                        AND
                            (SELECT date_of_birth FROM new_person) <= (
                                CURRENT_DATE -
                                INTERVAL '1 year' *
                                COALESCE(preference.min_age, 0)
                            )
                        AND
                            (SELECT date_of_birth FROM new_person) > (
                                CURRENT_DATE -
                                INTERVAL '1 year' *
                                (COALESCE(preference.max_age, 999) + 1)
                            )
                    )
                LIMIT
                    2000 * 2
            ), evaluated_midpoint AS (
                SELECT
                    MAX(dist) AS dist,
                    COUNT(*) AS cnt,
                    MAX(iters) AS iters
                FROM
                    limited_search_results
            ), points AS (
                SELECT dist, cnt, iters FROM evaluated_midpoint
                UNION
                SELECT dist, cnt, iters FROM two_closest
            )
            SELECT dist, cnt, iters + 1 FROM points WHERE iters < 5
        )
    )
    SELECT
        LEAST(dist, 10000) AS dist,
        cnt
    FROM
        t
    ORDER BY
        iters DESC,
        dist
    LIMIT
        1
    OFFSET
        1
), new_photo AS (
    INSERT INTO photo (
        person_id,
        position,
        uuid,
        blurhash,
        hash
    )
    SELECT
        new_person.id,
        position,
        onboardee_photo.uuid,
        onboardee_photo.blurhash,
        onboardee_photo.hash
    FROM onboardee_photo
    JOIN new_person
    ON onboardee_photo.email = new_person.email
), updated_session AS (
    UPDATE duo_session
    SET person_id = new_person.id
    FROM new_person
    WHERE duo_session.email = new_person.email
), p1 AS (
    INSERT INTO search_preference_gender (person_id, gender_id)
    SELECT new_person.id, gender_id
    FROM onboardee_search_preference_gender
    JOIN new_person
    ON new_person.email = onboardee_search_preference_gender.email
), p2 AS (
    INSERT INTO search_preference_orientation (person_id, orientation_id)
    SELECT new_person.id, orientation.id
    FROM new_person, orientation
), p3 AS (
    INSERT INTO search_preference_age (person_id, min_age, max_age)
    SELECT new_person.id, min_age, max_age
    FROM new_person, best_age
), p4 AS (
    INSERT INTO search_preference_distance (person_id, distance)
    SELECT
        new_person.id,
        CASE
            WHEN best_distance.cnt < 500
            THEN NULL

            WHEN best_distance.dist > 9000  -- It's over 9000
            THEN 9000

            WHEN %(pending_club_name)s::TEXT IS NOT NULL
            THEN NULL

            ELSE best_distance.dist
        END AS distance
    FROM new_person, best_distance
), p5 AS (
    INSERT INTO search_preference_height_cm (person_id, min_height_cm, max_height_cm)
    SELECT new_person.id, NULL, NULL
    FROM new_person
), p6 AS (
    INSERT INTO search_preference_has_profile_picture (person_id, has_profile_picture_id)
    SELECT new_person.id, yes_no.id
    FROM new_person, yes_no
), p7 AS (
    INSERT INTO search_preference_looking_for (person_id, looking_for_id)
    SELECT new_person.id, looking_for.id
    FROM new_person, looking_for
), p8 AS (
    INSERT INTO search_preference_smoking (person_id, smoking_id)
    SELECT new_person.id, yes_no_optional.id
    FROM new_person, yes_no_optional
), p9 AS (
    INSERT INTO search_preference_drinking (person_id, drinking_id)
    SELECT new_person.id, frequency.id
    FROM new_person, frequency
), p10 AS (
    INSERT INTO search_preference_drugs (person_id, drugs_id)
    SELECT new_person.id, yes_no_optional.id
    FROM new_person, yes_no_optional
), p11 AS (
    INSERT INTO search_preference_long_distance (person_id, long_distance_id)
    SELECT new_person.id, yes_no_optional.id
    FROM new_person, yes_no_optional
), p12 AS (
    INSERT INTO search_preference_relationship_status (person_id, relationship_status_id)
    SELECT new_person.id, relationship_status.id
    FROM new_person, relationship_status
), p13 AS (
    INSERT INTO search_preference_has_kids (person_id, has_kids_id)
    SELECT new_person.id, yes_no_optional.id
    FROM new_person, yes_no_optional
), p14 AS (
    INSERT INTO search_preference_wants_kids (person_id, wants_kids_id)
    SELECT new_person.id, yes_no_maybe.id
    FROM new_person, yes_no_maybe
), p15 AS (
    INSERT INTO search_preference_exercise (person_id, exercise_id)
    SELECT new_person.id, frequency.id
    FROM new_person, frequency
), p16 AS (
    INSERT INTO search_preference_religion (person_id, religion_id)
    SELECT new_person.id, religion.id
    FROM new_person, religion
), p17 AS (
    INSERT INTO search_preference_star_sign (person_id, star_sign_id)
    SELECT new_person.id, star_sign.id
    FROM new_person, star_sign
), p18 AS (
    INSERT INTO search_preference_messaged (person_id, messaged_id)
    SELECT new_person.id, yes_no.id
    FROM new_person, yes_no
    WHERE yes_no.name = 'Yes'
), p19 AS (
    INSERT INTO search_preference_skipped (person_id, skipped_id)
    SELECT new_person.id, yes_no.id
    FROM new_person, yes_no
    WHERE yes_no.name = 'No'
), p20 AS (
    INSERT INTO search_preference_ethnicity (person_id, ethnicity_id)
    SELECT new_person.id, ethnicity.id
    FROM new_person, ethnicity
), deleted_onboardee AS (
    DELETE FROM onboardee
    WHERE email = %(email)s
)
SELECT
    new_person.id AS person_id,
    new_person.uuid AS person_uuid,
    new_person.url_slug,
    (SELECT name FROM unit WHERE unit.id = new_person.unit_id) AS units,
    false AS do_show_donation_nag,
    {_Q_ESTIMATED_END_DATE},
    new_person.name AS name
FROM
    new_person
"""

Q_SELECT_PROSPECT_PROFILE = f"""
WITH prospect_base AS (
    SELECT *
    FROM person AS prospect
    WHERE
        (
            uuid = uuid_or_null(%(prospect_handle)s::TEXT)
        OR
            -- Slugs are always minted lower-case, so match exactly: a
            -- mixed-case handle resolves only as a uuid, never a slug. This
            -- keeps the canonical profile URL lower-case and matches the
            -- frontend's lower-case-only slug route.
            url_slug = %(prospect_handle)s
        )
    AND
        activated
    -- The OR lets the planner BitmapOr the uuid and url_slug indexes (a CASE
    -- here would hide both from it). A handle can in principle match two rows
    -- (a uuid for one person, a url_slug for another); prefer the exact-uuid
    -- match so a uuid handle always resolves to its owner, and LIMIT to one.
    ORDER BY
        (uuid = uuid_or_null(%(prospect_handle)s::TEXT)) DESC NULLS LAST
    LIMIT 1
), viewer_rel AS MATERIALIZED (
    -- Tiny (one row, two booleans). MATERIALIZED so the planner evaluates
    -- these as single-row index probes on (subject_person_id,
    -- object_person_id). Without the barrier the planner inlines the CTE and
    -- pulls the EXISTS clauses into the visibility filter's OR/NOT branches,
    -- where it can only express them as hashed subplans that scan *every* row
    -- targeting the viewer - so the cost grows with how many people have
    -- messaged or skipped the viewer.
    SELECT
        EXISTS (
            SELECT 1 FROM messaged
            WHERE messaged.subject_person_id = prospect_base.id
              AND messaged.object_person_id  = %(person_id)s
        ) AS prospect_has_messaged_person,
        EXISTS (
            SELECT 1 FROM skipped
            WHERE skipped.subject_person_id = prospect_base.id
              AND skipped.object_person_id  = %(person_id)s
        ) AS prospect_skipped_person
    FROM prospect_base
), prospect AS (
    SELECT
        prospect.*,

        (
            SELECT EXTRACT(YEAR FROM AGE(prospect.date_of_birth))::SMALLINT
            WHERE prospect.show_my_age
        ) AS age,

        (
            SELECT prospect.location_short_friendly
            WHERE prospect.show_my_location
        ) AS location,

        (
            ROUND(EXTRACT(EPOCH FROM NOW() - last_online_time))
        ) AS seconds_since_last_online,

        (
            ROUND(EXTRACT(EPOCH FROM NOW() - sign_up_time))
        ) AS seconds_since_sign_up,

        viewer_rel.prospect_has_messaged_person
    FROM
        prospect_base AS prospect,
        viewer_rel
    WHERE
        -- Signed-in viewer: gated by hide_me_from_strangers, verification
        -- level, and skipped status.
        (
            %(person_id)s IS NOT NULL
        AND (
                NOT prospect.hide_me_from_strangers
            OR
                viewer_rel.prospect_has_messaged_person
        )
        AND (
            prospect.privacy_verification_level_id <= (
                SELECT
                    verification_level_id
                FROM
                    person
                WHERE
                    id = %(person_id)s
            )
            OR
                viewer_rel.prospect_has_messaged_person
        )
        AND
            NOT viewer_rel.prospect_skipped_person
        )
        OR
        -- Anonymous viewer: only when the prospect has opted in to
        -- `public_profile`. `public_profile` overrides
        -- `hide_me_from_strangers` and `privacy_verification_level_id`.
        (
            %(person_id)s IS NULL
        AND
            prospect.public_profile
        )
        OR
        -- Self-view.
        prospect.id = %(person_id)s
), updated_visited AS (
    INSERT INTO visited (
        subject_person_id,
        object_person_id,
        updated_at,
        invisible
    )
    SELECT
        %(person_id)s AS subject_person_id,
        prospect.id AS object_person_id,
        now() AS updated_at,
        (
            SELECT
                person.browse_invisibly OR
                person.hide_me_from_strangers AND
                NOT prospect_has_messaged_person
            FROM
                person
            WHERE
                id = %(person_id)s
        ) AS invisible
    FROM
        prospect
    -- `visited.subject_person_id` is NOT NULL, so anonymous viewers can't
    -- record a visit.
    WHERE
        %(person_id)s IS NOT NULL
    ON CONFLICT (subject_person_id, object_person_id) DO UPDATE SET
        updated_at = now(),
        invisible = EXCLUDED.invisible
), negative_dot_prod AS (
    -- Empty for anonymous viewers, so `match_percentage` is NULL and the
    -- frontend hides the donut. Without the guard, `CLAMP(0, 99, NULL)`
    -- would coerce to 0 (`GREATEST(0, NULL) = 0`), misrepresenting itself
    -- as a genuine 0 percent match.
    SELECT (
        SELECT personality FROM person WHERE id = %(person_id)s
    ) <#> (
        SELECT personality FROM prospect
    ) AS negative_dot_prod
    WHERE %(person_id)s IS NOT NULL
), match_percentage AS (
    SELECT
        CLAMP(
            0,
            99,
            100 * (1 - negative_dot_prod.negative_dot_prod) / 2
        )::SMALLINT AS j
    FROM
        negative_dot_prod
), photos AS (
    SELECT
        COALESCE(json_agg(photo.uuid       ORDER BY position), '[]'::json) AS uuids,
        COALESCE(json_agg(photo.extra_exts ORDER BY position), '[]'::json) AS extra_exts,
        COALESCE(json_agg(photo.blurhash   ORDER BY position), '[]'::json) AS blurhashes,
        COALESCE(json_agg(photo.verified   ORDER BY position), '[]'::json) AS verifications
    FROM photo
    JOIN prospect
    ON   prospect.id = photo.person_id
), audio_bio_uuid AS (
    SELECT audio.uuid AS j
    FROM   audio
    JOIN   prospect
    ON     prospect.id = audio.person_id
    WHERE  audio.position = -1
), gender AS (
    SELECT gender.name AS j
    FROM gender JOIN prospect ON gender_id = gender.id
    WHERE gender.name != 'Unanswered'
), orientation AS (
    SELECT orientation.name AS j
    FROM orientation JOIN prospect ON orientation_id = orientation.id
    WHERE orientation.name != 'Unanswered'
), ethnicity AS (
    SELECT ethnicity.name AS j
    FROM ethnicity JOIN prospect ON ethnicity_id = ethnicity.id
    WHERE ethnicity.name != 'Unanswered'
), looking_for AS (
    SELECT looking_for.name AS j
    FROM looking_for JOIN prospect ON looking_for_id = looking_for.id
    WHERE looking_for.name != 'Unanswered'
    AND prospect.show_my_looking_for
), smoking AS (
    SELECT yes_no_optional.name AS j
    FROM yes_no_optional JOIN prospect ON smoking_id = yes_no_optional.id
    WHERE yes_no_optional.name != 'Unanswered'
), drinking AS (
    SELECT frequency.name AS j
    FROM frequency JOIN prospect ON drinking_id = frequency.id
    WHERE frequency.name != 'Unanswered'
), drugs AS (
    SELECT yes_no_optional.name AS j
    FROM yes_no_optional JOIN prospect ON drugs_id = yes_no_optional.id
    WHERE yes_no_optional.name != 'Unanswered'
), long_distance AS (
    SELECT yes_no_optional.name AS j
    FROM yes_no_optional JOIN prospect ON long_distance_id = yes_no_optional.id
    WHERE yes_no_optional.name != 'Unanswered'
    AND prospect.show_my_looking_for
), relationship_status AS (
    SELECT relationship_status.name AS j
    FROM relationship_status JOIN prospect ON relationship_status_id = relationship_status.id
    WHERE relationship_status.name != 'Unanswered'
), has_kids AS (
    SELECT yes_no_maybe.name AS j
    FROM yes_no_maybe JOIN prospect ON has_kids_id = yes_no_maybe.id
    WHERE yes_no_maybe.name != 'Unanswered'
), wants_kids AS (
    SELECT yes_no_maybe.name AS j
    FROM yes_no_maybe JOIN prospect ON wants_kids_id = yes_no_maybe.id
    WHERE yes_no_maybe.name != 'Unanswered'
), exercise AS (
    SELECT frequency.name AS j
    FROM frequency JOIN prospect ON exercise_id = frequency.id
    WHERE frequency.name != 'Unanswered'
), religion AS (
    SELECT religion.name AS j
    FROM religion JOIN prospect ON religion_id = religion.id
    WHERE religion.name != 'Unanswered'
), star_sign AS (
    SELECT star_sign.name AS j
    FROM star_sign JOIN prospect ON star_sign_id = star_sign.id
    WHERE star_sign.name != 'Unanswered'
), pref_gender AS (
    SELECT COALESCE(array_agg(g.name ORDER BY g.id), ARRAY[]::TEXT[]) AS j
    FROM search_preference_gender JOIN public.gender AS g
    ON search_preference_gender.gender_id = g.id
    WHERE search_preference_gender.person_id = (SELECT id FROM prospect)
    AND (SELECT show_my_looking_for FROM prospect)
), pref_age AS (
    SELECT json_build_object(
        'min_age', min_age,
        'max_age', max_age
    ) AS j
    FROM search_preference_age
    WHERE person_id = (SELECT id FROM prospect)
    AND (SELECT show_my_looking_for FROM prospect)
), is_skipped AS (
    SELECT
        EXISTS (
            SELECT 1
            FROM skipped
            WHERE
                subject_person_id = %(person_id)s AND
                object_person_id  = (SELECT id FROM prospect)
        ) AS j
), advertiser_friendly AS (
    -- Ads have been removed; this is kept as a constant so existing native
    -- clients (which validate this field) keep working without the DB spending
    -- time computing it.
    SELECT FALSE AS j
), clubs AS (
    SELECT
        prospect_person_club.club_name,
        person_club_.person_id IS NOT NULL AS is_mutual
    FROM
        person_club AS prospect_person_club
    LEFT JOIN
        person_club AS person_club_
    ON
        prospect_person_club.club_name = person_club_.club_name
    AND
        person_club_.person_id = %(person_id)s
    WHERE
        prospect_person_club.person_id = (SELECT id FROM prospect)
    ORDER BY
        is_mutual DESC,
        club_name
), mutual_clubs_json AS (
    SELECT COALESCE(
        json_agg(
            club_name
            ORDER BY
                is_mutual DESC,
                club_name
        ),
        '[]'::json
    ) AS j
    FROM clubs
    WHERE is_mutual
), other_clubs_json AS (
    SELECT COALESCE(
        json_agg(
            club_name
            ORDER BY
                is_mutual DESC,
                club_name
        ),
        '[]'::json
    ) AS j
    FROM clubs
    WHERE NOT is_mutual
), flair AS (
    SELECT
        ({Q_COMPUTED_FLAIR}) AS computed_flair
    FROM
        prospect
)
SELECT
    json_build_object(
        'person_id',                 (SELECT id                        FROM prospect),
        'person_uuid',               (SELECT uuid                      FROM prospect),
        'photo_uuids',               (SELECT uuids                     FROM photos),
        'photo_extra_exts',          (SELECT extra_exts                FROM photos),
        'photo_blurhashes',          (SELECT blurhashes                FROM photos),
        'photo_verifications',       (SELECT verifications             FROM photos),
        'audio_bio_uuid',            (SELECT j                         FROM audio_bio_uuid),
        'name',                      (SELECT name                      FROM prospect),
        'url_slug',                  (SELECT url_slug                  FROM prospect),
        'age',                       (SELECT age                       FROM prospect),
        'location',                  (SELECT location                  FROM prospect),
        'match_percentage',          (SELECT j                         FROM match_percentage),
        'about',                     (SELECT about                     FROM prospect),
        'count_answers',             (SELECT count_answers             FROM prospect),
        'is_skipped',                (SELECT j                         FROM is_skipped),
        'advertiser_friendly',       (SELECT j                         FROM advertiser_friendly),
        'seconds_since_last_online', (SELECT seconds_since_last_online FROM prospect),
        'seconds_since_sign_up',     (SELECT seconds_since_sign_up     FROM prospect),
        'flair',                     (SELECT computed_flair            FROM flair),

        -- Basics
        'occupation',             (SELECT occupation    FROM prospect),
        'education',              (SELECT education     FROM prospect),
        'height_cm',              (SELECT height_cm     FROM prospect),
        'gender',                 (SELECT j             FROM gender),
        'orientation',            (SELECT j             FROM orientation),
        'ethnicity',              (SELECT j             FROM ethnicity),
        'looking_for',            (SELECT j             FROM looking_for),
        'smoking',                (SELECT j             FROM smoking),
        'drinking',               (SELECT j             FROM drinking),
        'drugs',                  (SELECT j             FROM drugs),
        'long_distance',          (SELECT j             FROM long_distance),
        'relationship_status',    (SELECT j             FROM relationship_status),
        'has_kids',               (SELECT j             FROM has_kids),
        'wants_kids',             (SELECT j             FROM wants_kids),
        'exercise',               (SELECT j             FROM exercise),
        'religion',               (SELECT j             FROM religion),
        'star_sign',              (SELECT j             FROM star_sign),
        'gender_preference',      (SELECT j             FROM pref_gender),
        'age_preference',         (SELECT j             FROM pref_age),
        'show_my_looking_for',    (SELECT CASE WHEN show_my_looking_for THEN 'Yes' ELSE 'No' END FROM prospect),

        -- Clubs
        'mutual_clubs',           (SELECT j             FROM mutual_clubs_json),
        'other_clubs',            (SELECT j             FROM other_clubs_json),

        -- Verifications
        'verified_age',           (SELECT verified_age       FROM prospect),
        'verified_gender',        (SELECT verified_gender    FROM prospect),
        'verified_ethnicity',     (SELECT verified_ethnicity FROM prospect),

        -- Theme
        'theme', json_build_object(
            'title_color',         (SELECT title_color      FROM prospect),
            'body_color',          (SELECT body_color       FROM prospect),
            'background_color',    (SELECT background_color FROM prospect)
        )
    ) AS j,
    (SELECT id   FROM prospect) AS prospect_id,
    (SELECT uuid FROM prospect) AS prospect_uuid
WHERE
    EXISTS (SELECT 1 FROM prospect)
"""

# Slim variant of `Q_SELECT_PROSPECT_PROFILE` for the chat header. Returns just
# the fields the conversation screen renders (name, primary photo, skipped
# state) and deliberately does NOT write to `visited` — opening someone's
# chat is not the same as viewing their profile, so it shouldn't surface them
# in the prospect's "Visitors" tab.
Q_SELECT_CONVERSATION_PROSPECT = """
WITH prospect AS (
    SELECT
        person.id,
        person.name,
        person.url_slug
    FROM
        person
    LEFT JOIN LATERAL (
        SELECT
            EXISTS (
                SELECT 1
                FROM messaged
                WHERE
                    messaged.subject_person_id = person.id
                AND
                    messaged.object_person_id = %(person_id)s
            ) AS prospect_has_messaged_person
    ) AS m
    ON
        TRUE
    WHERE
        uuid = uuid_or_null(%(prospect_uuid)s::TEXT)
    AND
        activated
    AND (
        (
            person.shadow_banned_at IS NULL
        AND (
                NOT person.hide_me_from_strangers
            OR
                m.prospect_has_messaged_person
            )
        AND (
                person.privacy_verification_level_id <= (
                    SELECT verification_level_id
                    FROM person AS viewer
                    WHERE viewer.id = %(person_id)s
                )
            OR
                m.prospect_has_messaged_person
        )
        AND
            NOT EXISTS (
                SELECT 1
                FROM skipped
                WHERE
                    subject_person_id = person.id AND
                    object_person_id  = %(person_id)s
            )
        )
        OR
            person.id = %(person_id)s
    )
), primary_photo AS (
    SELECT
        photo.uuid AS photo_uuid,
        photo.blurhash AS photo_blurhash
    FROM
        photo
    JOIN
        prospect ON prospect.id = photo.person_id
    ORDER BY
        photo.position
    LIMIT 1
), is_skipped AS (
    SELECT
        EXISTS (
            SELECT 1
            FROM skipped
            WHERE
                subject_person_id = %(person_id)s AND
                object_person_id  = (SELECT id FROM prospect)
        ) AS j
)
SELECT
    json_build_object(
        -- `is_available` is always `true` for a 200 response: the `prospect`
        -- CTE filters out deactivated, hidden, and prospect-skipped-viewer
        -- cases, which surface as 404. Returning the field explicitly (rather
        -- than letting clients infer availability from `name IS NULL`)
        -- decouples "should the name render?" from "is this conversation
        -- actionable?" so future cases (e.g. temporarily-deactivated accounts
        -- where we still want to render the name) can diverge cleanly.
        'is_available',   true,
        'name',           (SELECT name           FROM prospect),
        'url_slug',       (SELECT url_slug       FROM prospect),
        'photo_uuid',     (SELECT photo_uuid     FROM primary_photo),
        'photo_blurhash', (SELECT photo_blurhash FROM primary_photo),
        'is_skipped',     (SELECT j              FROM is_skipped)
    ) AS j
WHERE
    EXISTS (SELECT 1 FROM prospect)
"""

Q_CHECK_SESSION_TOKEN = f"""
SELECT
    name,
    has_gold,
    {_Q_DO_SHOW_DONATION_NAG.format(table='person')},
    {_Q_ESTIMATED_END_DATE},
    (SELECT name FROM unit WHERE unit.id = person.unit_id) AS units
FROM
    person
WHERE
    id = %(person_id)s
"""

Q_DELETE_SKIPPED_BY_UUID = """
DELETE FROM
    skipped
USING
    person
WHERE
    person.id = skipped.object_person_id
AND
    person.uuid = uuid_or_null(%(prospect_uuid)s)
AND
    subject_person_id = %(subject_person_id)s
"""

Q_ANSWER_COMPARISON = """
WITH prospect_name AS(
    SELECT name FROM person WHERE id = %(prospect_person_id)s
), person_name AS(
    SELECT name FROM person WHERE id = %(person_id)s
)
SELECT
    prospect_answer.person_id AS prospect_person_id,
    (SELECT name FROM prospect_name) AS prospect_name,
    prospect_answer.answer AS prospect_answer,
    person_answer.person_id AS person_id,
    (SELECT name FROM person_name) AS person_name,
    person_answer.answer AS person_answer,
    person_answer.public_ AS person_public_,
    question.id AS question_id,
    question.question AS question,
    question.topic AS topic
FROM (
    SELECT
        person_id,
        question_id,
        answer.answer
    FROM
        answer
    JOIN
        question ON
        question.id = answer.question_id AND
        (question.topic = %(topic)s OR %(topic)s = 'All') AND
        answer.person_id = %(prospect_person_id)s AND
        answer.public_ = TRUE AND
        answer.answer IS NOT NULL AND
        (
            %(prospect_person_id)s = %(person_id)s OR
            NOT EXISTS (
                SELECT 1 FROM person
                WHERE id = %(prospect_person_id)s AND shadow_banned_at IS NOT NULL
            )
        )
) AS prospect_answer
JOIN
    question ON
    question.id = prospect_answer.question_id
LEFT JOIN
    answer AS person_answer ON
    person_answer.person_id = %(person_id)s AND
    person_answer.question_id = prospect_answer.question_id
WHERE
    (
        %(agreement)s != 'Agree' OR
        person_answer.answer IS NOT NULL AND
        prospect_answer.answer IS NOT NULL AND
        person_answer.answer = prospect_answer.answer
    ) AND (
        %(agreement)s != 'Disagree' OR
        person_answer.answer IS NOT NULL AND
        prospect_answer.answer IS NOT NULL AND
        person_answer.answer != prospect_answer.answer
    ) AND (
        %(agreement)s != 'Unanswered' OR
        person_answer.answer IS NULL
    )
ORDER BY
    question.id
LIMIT %(n)s
OFFSET %(o)s
"""

Q_INBOX_INFO = """
WITH partner AS (
    SELECT object_person_id AS id FROM messaged WHERE subject_person_id = %(person_id)s
    UNION
    SELECT subject_person_id AS id FROM messaged WHERE object_person_id = %(person_id)s
), person_info AS (
    SELECT
        partner.id AS person_id,
        prospect.uuid AS person_uuid,
        prospect.id IS NULL AS is_prospect_deleted,
        COALESCE(
            prospect.activated AND prospect.shadow_banned_at IS NULL, FALSE
        ) AS is_prospect_activated,
        prospect.name AS name,
        prospect.url_slug AS url_slug,
        prospect.personality AS personality,
        prospect.verification_level_id > 1 AS verified,
        EXISTS (
            SELECT
                1
            FROM
                messaged
            WHERE
                subject_person_id = %(person_id)s
            AND
                object_person_id = partner.id
        ) AS person_messaged_prospect,
        EXISTS (
            SELECT
                1
            FROM
                messaged
            WHERE
                subject_person_id = partner.id
            AND
                object_person_id = %(person_id)s
        ) AS prospect_messaged_person,
        EXISTS (
            SELECT
                1
            FROM
                skipped
            WHERE
                subject_person_id = %(person_id)s
            AND
                object_person_id = partner.id
        ) AS person_skipped_prospect,
        EXISTS (
            SELECT
                1
            FROM
                skipped
            WHERE
                subject_person_id = partner.id
            AND
                object_person_id = %(person_id)s
        ) AS prospect_skipped_person
    FROM
        partner
    LEFT JOIN
        person AS prospect
    ON
        prospect.id = partner.id
)
SELECT
    person_id,
    person_uuid,
    url_slug,
    CASE
        WHEN is_prospect_activated AND NOT prospect_skipped_person
        THEN
            verified
        ELSE
            FALSE
    END AS verified,
    CASE
        WHEN is_prospect_activated AND NOT prospect_skipped_person
        THEN
            name
        ELSE
            NULL
    END AS name,
    CASE
        WHEN is_prospect_activated AND NOT prospect_skipped_person
        THEN
            CLAMP(
                0,
                99,
                100 * (
                    1 - (
                        SELECT (
                            SELECT personality FROM person WHERE id = %(person_id)s
                        ) <#> (
                            prospect.personality
                        )
                    )
                ) / 2
            )::SMALLINT
        ELSE
            NULL
    END AS match_percentage,
    CASE
        WHEN is_prospect_activated AND NOT prospect_skipped_person
        THEN
            (
                SELECT
                    uuid
                FROM
                    photo
                WHERE
                    person_id = prospect.person_id
                ORDER BY
                    position
                LIMIT 1
            )
        ELSE
            NULL
    END AS image_uuid,
    CASE
        WHEN is_prospect_activated AND NOT prospect_skipped_person
        THEN
            (
                SELECT
                    blurhash
                FROM
                    photo
                WHERE
                    person_id = prospect.person_id
                ORDER BY
                    position
                LIMIT 1
            )
        ELSE
            NULL
    END AS image_blurhash,
    CASE
        WHEN
                NOT is_prospect_deleted
            AND
                NOT prospect_messaged_person
        THEN 'nowhere'
        WHEN
                is_prospect_activated
            AND
                NOT prospect_skipped_person
            AND
                NOT person_skipped_prospect
            AND
                prospect_messaged_person
            AND
                person_messaged_prospect
        THEN 'chats'
        WHEN
                is_prospect_activated
            AND
                NOT prospect_skipped_person
            AND
                NOT person_skipped_prospect
            AND
                prospect_messaged_person
            AND
                NOT person_messaged_prospect
        THEN 'intros'
        ELSE 'archive'
    END AS conversation_location
FROM
    person_info AS prospect
ORDER BY
    person_id
"""

Q_SELECT_SESSION_TOKEN_HASHES_BY_PERSON_ID = """
SELECT
    session_token_hash
FROM
    duo_session
WHERE
    person_id = ANY(%(person_ids)s)
"""

Q_DELETE_ACCOUNT = """
WITH deleted_inbox AS (
    DELETE FROM inbox
    WHERE luser = %(person_uuid)s
), deleted_mam_message AS (
    DELETE FROM mam_message
    WHERE person_id = %(person_id)s
    RETURNING audio_uuid
), deleted_photo AS (
    SELECT
        uuid
    FROM
        photo
    WHERE
        person_id = %(person_id)s
), deleted_audio AS (
    SELECT
        uuid
    FROM
        audio
    WHERE
        person_id = %(person_id)s
), deleted_verification_photo AS (
    SELECT
        photo_uuid AS uuid
    FROM
        verification_job
    WHERE
        person_id = %(person_id)s
), every_deleted_photo_uuid AS (
    SELECT uuid FROM deleted_photo
    UNION
    SELECT uuid FROM deleted_verification_photo
), every_deleted_audio_uuid AS (
    SELECT uuid FROM deleted_audio

    UNION

    SELECT
        deleted_mam_message.audio_uuid AS uuid
    FROM
        deleted_mam_message
    LEFT JOIN
        mam_message
    ON
        mam_message.audio_uuid = deleted_mam_message.audio_uuid
    AND
        mam_message.person_id <> %(person_id)s
    WHERE
        deleted_mam_message.audio_uuid IS NOT NULL
    AND
        mam_message.audio_uuid IS NULL
), deleted_person_club AS (
    SELECT
        club_name
    FROM
        person_club
    WHERE
        person_id  = %(person_id)s
), deleted_person AS (
    DELETE FROM
        person
    WHERE
        id = %(person_id)s
    RETURNING
        activated
), undeleted_photo_insertion AS (
    INSERT INTO undeleted_photo (
        uuid
    )
    SELECT
        uuid
    FROM
        every_deleted_photo_uuid
), undeleted_audio_insertion AS (
    INSERT INTO undeleted_audio (
        uuid
    )
    SELECT
        uuid
    FROM
        every_deleted_audio_uuid
), club_update AS (
    UPDATE
        club
    SET
        count_members = GREATEST(0, count_members - 1)
    FROM
        deleted_person_club
    WHERE
        club.name = deleted_person_club.club_name
    AND
        (SELECT activated FROM deleted_person)
)
SELECT 1
"""

Q_POST_DEACTIVATE = """
WITH updated_person AS (
    UPDATE
        person
    SET
        activated = FALSE
    WHERE
        activated = TRUE
    AND
        id = %(person_id)s
    RETURNING
        id
), decrement_club AS (
    UPDATE
        club
    SET
        count_members = GREATEST(0, count_members - 1)
    FROM
        person_club
    WHERE
        person_club.club_name = club.name
    AND
        person_club.person_id IN (SELECT id FROM updated_person)
)
SELECT 1
"""

Q_GET_PROFILE_INFO = f"""
WITH photo_ AS (
    SELECT json_object_agg(position, uuid) AS j
    FROM photo
    WHERE person_id = %(person_id)s
), photo_extra_exts AS (
    SELECT json_object_agg(position, extra_exts) AS j
    FROM photo
    WHERE person_id = %(person_id)s
), photo_blurhash AS (
    SELECT json_object_agg(position, blurhash) AS j
    FROM photo
    WHERE person_id = %(person_id)s
), photo_verification AS (
    SELECT json_object_agg(position, verified) AS j
    FROM photo
    WHERE person_id = %(person_id)s
), audio_bio AS (
    SELECT uuid AS j FROM audio WHERE person_id = %(person_id)s AND position = -1
), name AS (
    SELECT name AS j FROM person WHERE id = %(person_id)s
), url_slug AS (
    SELECT url_slug AS j FROM person WHERE id = %(person_id)s
), about AS (
    SELECT about AS j FROM person WHERE id = %(person_id)s
), gender AS (
    SELECT gender.name AS j
    FROM gender JOIN person ON gender_id = gender.id
    WHERE person.id = %(person_id)s
), orientation AS (
    SELECT orientation.name AS j
    FROM orientation JOIN person ON orientation_id = orientation.id
    WHERE person.id = %(person_id)s
), ethnicity AS (
    SELECT ethnicity.name AS j
    FROM ethnicity JOIN person ON ethnicity_id = ethnicity.id
    WHERE person.id = %(person_id)s
), location AS (
    SELECT location_long_friendly AS j
    FROM person
    WHERE id = %(person_id)s
), occupation AS (
    SELECT occupation AS j FROM person WHERE id = %(person_id)s
), education AS (
    SELECT education AS j FROM person WHERE id = %(person_id)s
), height AS (
    SELECT height_cm AS j FROM person WHERE id = %(person_id)s
), looking_for AS (
    SELECT looking_for.name AS j
    FROM looking_for JOIN person ON looking_for_id = looking_for.id
    WHERE person.id = %(person_id)s
), smoking AS (
    SELECT yes_no_optional.name AS j
    FROM yes_no_optional JOIN person ON smoking_id = yes_no_optional.id
    WHERE person.id = %(person_id)s
), drinking AS (
    SELECT frequency.name AS j
    FROM frequency JOIN person ON drinking_id = frequency.id
    WHERE person.id = %(person_id)s
), drugs AS (
    SELECT yes_no_optional.name AS j
    FROM yes_no_optional JOIN person ON drugs_id = yes_no_optional.id
    WHERE person.id = %(person_id)s
), long_distance AS (
    SELECT yes_no_optional.name AS j
    FROM yes_no_optional JOIN person ON long_distance_id = yes_no_optional.id
    WHERE person.id = %(person_id)s
), relationship_status AS (
    SELECT relationship_status.name AS j
    FROM relationship_status JOIN person ON relationship_status_id = relationship_status.id
    WHERE person.id = %(person_id)s
), has_kids AS (
    SELECT yes_no_maybe.name AS j
    FROM yes_no_maybe JOIN person ON has_kids_id = yes_no_maybe.id
    WHERE person.id = %(person_id)s
), wants_kids AS (
    SELECT yes_no_maybe.name AS j
    FROM yes_no_maybe JOIN person ON wants_kids_id = yes_no_maybe.id
    WHERE person.id = %(person_id)s
), exercise AS (
    SELECT frequency.name AS j
    FROM frequency JOIN person ON exercise_id = frequency.id
    WHERE person.id = %(person_id)s
), religion AS (
    SELECT religion.name AS j
    FROM religion JOIN person ON religion_id = religion.id
    WHERE person.id = %(person_id)s
), star_sign AS (
    SELECT star_sign.name AS j
    FROM star_sign JOIN person ON star_sign_id = star_sign.id
    WHERE person.id = %(person_id)s

), clubs AS (
    SELECT
        COALESCE(
            json_agg(
                json_build_object(
                    'name', name,
                    'count_members', count_members
                )
                ORDER BY name
            ),
            '[]'::json
        ) AS j
    FROM person_club
    JOIN club ON club.name = club_name
    WHERE person_id = %(person_id)s

), unit AS (
    SELECT unit.name AS j
    FROM unit JOIN person ON unit_id = unit.id
    WHERE person.id = %(person_id)s

), chat AS (
    SELECT immediacy.name AS j
    FROM immediacy JOIN person ON chats_notification = immediacy.id
    WHERE person.id = %(person_id)s
), intro AS (
    SELECT immediacy.name AS j
    FROM immediacy JOIN person ON intros_notification = immediacy.id
    WHERE person.id = %(person_id)s

), privacy_verification_level AS (
    SELECT
        verification_level.name AS j
    FROM person
    JOIN verification_level
    ON verification_level.id = person.privacy_verification_level_id
    WHERE person.id = %(person_id)s
), show_my_location AS (
    SELECT
        CASE WHEN show_my_location THEN 'Yes' ELSE 'No' END AS j
    FROM person
    WHERE id = %(person_id)s
), show_my_age AS (
    SELECT
        CASE WHEN show_my_age THEN 'Yes' ELSE 'No' END AS j
    FROM person
    WHERE id = %(person_id)s
), show_my_looking_for AS (
    SELECT
        CASE WHEN show_my_looking_for THEN 'Yes' ELSE 'No' END AS j
    FROM person
    WHERE id = %(person_id)s
), hide_me_from_strangers AS (
    SELECT
        CASE WHEN hide_me_from_strangers THEN 'Yes' ELSE 'No' END AS j
    FROM person
    WHERE id = %(person_id)s
), browse_invisibly AS (
    SELECT
        CASE WHEN browse_invisibly THEN 'Yes' ELSE 'No' END AS j
    FROM person
    WHERE id = %(person_id)s
), public_profile AS (
    SELECT
        CASE WHEN public_profile THEN 'Yes' ELSE 'No' END AS j
    FROM person
    WHERE id = %(person_id)s
), verified_gender AS (
    SELECT verified_gender AS j FROM person WHERE id = %(person_id)s
), verified_age AS (
    SELECT verified_age AS j FROM person WHERE id = %(person_id)s
), verified_ethnicity AS (
    SELECT verified_ethnicity AS j FROM person WHERE id = %(person_id)s
), title_color AS (
    SELECT title_color AS j FROM person WHERE id = %(person_id)s
), body_color AS (
    SELECT body_color AS j FROM person WHERE id = %(person_id)s
), background_color AS (
    SELECT background_color AS j FROM person WHERE id = %(person_id)s
), flair AS (
    SELECT ({Q_COMPUTED_FLAIR}) AS j FROM person WHERE id = %(person_id)s
)
SELECT
    json_build_object(
        'photo',                  (SELECT j FROM photo_),
        'photo_extra_exts',       (SELECT j FROM photo_extra_exts),
        'photo_blurhash',         (SELECT j FROM photo_blurhash),
        'photo_verification',     (SELECT j FROM photo_verification),
        'audio_bio_max_seconds',  {constants.MAX_AUDIO_SECONDS},
        'audio_bio',              (SELECT j FROM audio_bio),
        'name',                   (SELECT j FROM name),
        'url_slug',               (SELECT j FROM url_slug),
        'about',                  (SELECT j FROM about),
        'gender',                 (SELECT j FROM gender),
        'orientation',            (SELECT j FROM orientation),
        'ethnicity',              (SELECT j FROM ethnicity),
        'location',               (SELECT j FROM location),
        'occupation',             (SELECT j FROM occupation),
        'education',              (SELECT j FROM education),
        'height',                 (SELECT j FROM height),
        'looking for',            (SELECT j FROM looking_for),
        'smoking',                (SELECT j FROM smoking),
        'drinking',               (SELECT j FROM drinking),
        'drugs',                  (SELECT j FROM drugs),
        'long distance',          (SELECT j FROM long_distance),
        'relationship status',    (SELECT j FROM relationship_status),
        'has kids',               (SELECT j FROM has_kids),
        'wants kids',             (SELECT j FROM wants_kids),
        'exercise',               (SELECT j FROM exercise),
        'religion',               (SELECT j FROM religion),
        'star sign',              (SELECT j FROM star_sign),

        'clubs',                  (SELECT j FROM clubs),

        'units',                  (SELECT j FROM unit),

        'chats',                  (SELECT j FROM chat),
        'intros',                 (SELECT j FROM intro),

        'verification level',     (SELECT j FROM privacy_verification_level),
        'public profile',         (SELECT j FROM public_profile),
        'show my location',       (SELECT j FROM show_my_location),
        'show my age',            (SELECT j FROM show_my_age),
        'show my looking for',    (SELECT j FROM show_my_looking_for),
        'hide me from strangers', (SELECT j FROM hide_me_from_strangers),
        'browse invisibly',       (SELECT j FROM browse_invisibly),

        'verified_gender',        (SELECT j FROM verified_gender),
        'verified_age',           (SELECT j FROM verified_age),
        'verified_ethnicity',     (SELECT j FROM verified_ethnicity),

        'theme', json_build_object(
            'title_color',            (SELECT j FROM title_color),
            'body_color',             (SELECT j FROM body_color),
            'background_color',       (SELECT j FROM background_color)
        ),

        'flair', (SELECT j FROM flair)

    ) AS j
"""

Q_DELETE_PROFILE_INFO_PHOTO = """
WITH deleted_photo AS (
    DELETE FROM
        photo
    WHERE
        person_id = %(person_id)s
    AND
        position = %(position)s
    RETURNING
        uuid
), deleted_person_event AS (
    UPDATE
        person
    SET
        last_event_time = sign_up_time,
        last_event_name = 'joined',
        last_event_data = '{}'
    WHERE
        id = %(person_id)s
    AND
        (last_event_data->>'added_photo_uuid')::TEXT = (
            SELECT
                uuid
            FROM
                deleted_photo
        )
)
INSERT INTO undeleted_photo (
    uuid
)
SELECT
    uuid
FROM
    deleted_photo
"""

Q_DELETE_PROFILE_INFO_AUDIO = """
WITH deleted_audio AS (
    DELETE FROM
        audio
    WHERE
        person_id = %(person_id)s
    AND
        position = %(position)s
    RETURNING
        uuid
), deleted_person_event AS (
    UPDATE
        person
    SET
        last_event_time = sign_up_time,
        last_event_name = 'joined',
        last_event_data = '{}'
    WHERE
        id = %(person_id)s
    AND
        (last_event_data->>'added_audio_uuid')::TEXT = (
            SELECT
                uuid
            FROM
                deleted_audio
        )
)
INSERT INTO undeleted_audio (
    uuid
)
SELECT
    uuid
FROM
    deleted_audio
"""

Q_GET_SEARCH_FILTERS = """
WITH answer AS (
    SELECT COALESCE(
        array_agg(
            json_build_object(
                'question_id', question_id,
                'question', question,
                'topic', topic,
                'answer', answer,
                'accept_unanswered', accept_unanswered
            )
            ORDER BY question_id
        ),
        ARRAY[]::JSON[]
    ) AS j
    FROM search_preference_answer
    LEFT JOIN question
    ON question.id = question_id
    WHERE person_id = %(person_id)s
), gender AS (
    SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[]) AS j
    FROM search_preference_gender JOIN gender
    ON gender_id = gender.id
    WHERE person_id = %(person_id)s
), orientation AS (
    SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[]) AS j
    FROM search_preference_orientation JOIN orientation
    ON orientation_id = orientation.id
    WHERE person_id = %(person_id)s
), ethnicity AS (
    SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[]) AS j
    FROM search_preference_ethnicity JOIN ethnicity
    ON ethnicity_id = ethnicity.id
    WHERE person_id = %(person_id)s
), age AS (
    SELECT json_build_object(
        'min_age', min_age,
        'max_age', max_age
    ) AS j
    FROM search_preference_age
    WHERE person_id = %(person_id)s
), furthest_distance AS (
    SELECT distance AS j
    FROM search_preference_distance
    WHERE person_id = %(person_id)s
), height AS (
    SELECT json_build_object(
        'min_height_cm', min_height_cm,
        'max_height_cm', max_height_cm
    ) AS j
    FROM search_preference_height_cm
    WHERE person_id = %(person_id)s
), has_a_profile_picture AS (
    SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[]) AS j
    FROM search_preference_has_profile_picture JOIN yes_no
    ON has_profile_picture_id = yes_no.id
    WHERE person_id = %(person_id)s
), looking_for AS (
    SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[]) AS j
    FROM search_preference_looking_for JOIN looking_for
    ON looking_for_id = looking_for.id
    WHERE person_id = %(person_id)s
), smoking AS (
    SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[]) AS j
    FROM search_preference_smoking JOIN yes_no_optional
    ON smoking_id = yes_no_optional.id
    WHERE person_id = %(person_id)s
), drinking AS (
    SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[]) AS j
    FROM search_preference_drinking JOIN frequency
    ON drinking_id = frequency.id
    WHERE person_id = %(person_id)s
), drugs AS (
    SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[]) AS j
    FROM search_preference_drugs JOIN yes_no_optional
    ON drugs_id = yes_no_optional.id
    WHERE person_id = %(person_id)s
), long_distance AS (
    SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[]) AS j
    FROM search_preference_long_distance JOIN yes_no_optional
    ON long_distance_id = yes_no_optional.id
    WHERE person_id = %(person_id)s
), relationship_status AS (
    SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[]) AS j
    FROM search_preference_relationship_status JOIN relationship_status
    ON relationship_status_id = relationship_status.id
    WHERE person_id = %(person_id)s
), has_kids AS (
    SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[]) AS j
    FROM search_preference_has_kids JOIN yes_no_optional
    ON has_kids_id = yes_no_optional.id
    WHERE person_id = %(person_id)s
), wants_kids AS (
    SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[]) AS j
    FROM search_preference_wants_kids JOIN yes_no_maybe
    ON wants_kids_id = yes_no_maybe.id
    WHERE person_id = %(person_id)s
), exercise AS (
    SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[]) AS j
    FROM search_preference_exercise JOIN frequency
    ON exercise_id = frequency.id
    WHERE person_id = %(person_id)s
), religion AS (
    SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[]) AS j
    FROM search_preference_religion JOIN religion
    ON religion_id = religion.id
    WHERE person_id = %(person_id)s
), star_sign AS (
    SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::TEXT[]) AS j
    FROM search_preference_star_sign JOIN star_sign
    ON star_sign_id = star_sign.id
    WHERE person_id = %(person_id)s
), people_you_messaged AS (
    SELECT name AS j
    FROM search_preference_messaged JOIN yes_no
    ON messaged_id = yes_no.id
    WHERE person_id = %(person_id)s
), people_you_skipped AS (
    SELECT name AS j
    FROM search_preference_skipped JOIN yes_no
    ON skipped_id = yes_no.id
    WHERE person_id = %(person_id)s
)
SELECT
    json_build_object(
        'answer',                 (SELECT j FROM answer),

        'gender',                 (SELECT j FROM gender),
        'orientation',            (SELECT j FROM orientation),
        'ethnicity',              (SELECT j FROM ethnicity),
        'age',                    (SELECT j FROM age),
        'furthest_distance',      (SELECT j FROM furthest_distance),
        'height',                 (SELECT j FROM height),
        'has_a_profile_picture',  (SELECT j FROM has_a_profile_picture),
        'looking_for',            (SELECT j FROM looking_for),
        'smoking',                (SELECT j FROM smoking),
        'drinking',               (SELECT j FROM drinking),
        'drugs',                  (SELECT j FROM drugs),
        'long_distance',          (SELECT j FROM long_distance),
        'relationship_status',    (SELECT j FROM relationship_status),
        'has_kids',               (SELECT j FROM has_kids),
        'wants_kids',             (SELECT j FROM wants_kids),
        'exercise',               (SELECT j FROM exercise),
        'religion',               (SELECT j FROM religion),
        'star_sign',              (SELECT j FROM star_sign),

        'people_you_messaged',    (SELECT j FROM people_you_messaged),
        'people_you_skipped',     (SELECT j FROM people_you_skipped)
    ) AS j
"""

Q_TOP_CLUBS = f"""
SELECT
    name,
    count_members
FROM
    club
ORDER BY
    count_members DESC,
    name
LIMIT {MAX_CLUB_SEARCH_RESULTS}
"""

Q_SEARCH_CLUBS = f"""
WITH currently_joined_club AS (
    SELECT
        club_name AS name
    FROM
        person_club
    WHERE
        person_id = %(person_id)s
), is_allowed_club_name AS (
    {Q_IS_ALLOWED_CLUB_NAME.replace('%()s', '%(search_string)s')}
), maybe_stuff_the_user_typed AS (
    SELECT
        %(search_string)s AS name,
        COALESCE(
            (SELECT count_members FROM club WHERE name = %(search_string)s),
            0
        ) AS count_members
    WHERE
        NOT EXISTS (
            SELECT 1 FROM currently_joined_club WHERE name = %(search_string)s
        )
    AND
        (SELECT is_allowed_club_name FROM is_allowed_club_name)
    LIMIT
        1
), fuzzy_match AS (
    SELECT
        name,
        count_members
    FROM
        club
    WHERE
        name NOT IN (SELECT name FROM currently_joined_club)
    AND
        name NOT IN (SELECT name FROM maybe_stuff_the_user_typed)
    AND
        count_members > 0
    ORDER BY
        name <-> %(search_string)s
    LIMIT
        {MAX_CLUB_SEARCH_RESULTS} - (SELECT COUNT(*) FROM maybe_stuff_the_user_typed)
)
SELECT
    name,
    count_members
FROM (
    SELECT name, count_members FROM fuzzy_match UNION
    SELECT name, count_members FROM maybe_stuff_the_user_typed
)
ORDER BY
    count_members = 0,
    name <-> %(search_string)s,
    count_members DESC,
    name
"""

Q_JOIN_CLUB = f"""
WITH is_allowed_club_name AS (
    {Q_IS_ALLOWED_CLUB_NAME.replace('%()s', '%(club_name)s')}
), quota AS (
  SELECT
      CASE
          WHEN person.has_gold
          THEN {CLUB_QUOTA_GOLD}
          ELSE {CLUB_QUOTA_FREE}
      END as quota
  FROM
      person
  WHERE
      id = %(person_id)s
), will_be_within_club_quota AS (
    SELECT
        COUNT(*) < (SELECT quota FROM quota) AS x
    FROM
        person_club
    WHERE
        person_id = %(person_id)s
), existing_club AS (
    SELECT
        name
    FROM
        club
    WHERE
        name = %(club_name)s
    AND
        (SELECT is_allowed_club_name FROM is_allowed_club_name)
    AND
        (SELECT x FROM will_be_within_club_quota)
), inserted_club AS (
    INSERT INTO club (
        name,
        count_members
    )
    SELECT
        %(club_name)s,
        1
    WHERE
        (SELECT is_allowed_club_name FROM is_allowed_club_name)
    AND
        (SELECT x FROM will_be_within_club_quota)
    ON CONFLICT (name) DO NOTHING
    RETURNING
        name
), existing_or_inserted_club AS (
    SELECT name FROM existing_club UNION
    SELECT name FROM inserted_club
), inserted_person_club AS (
    INSERT INTO person_club (
        person_id,
        club_name
    )
    SELECT
        %(person_id)s,
        name
    FROM
        existing_or_inserted_club
    ON CONFLICT (person_id, club_name) DO NOTHING
    RETURNING
        club_name
), updated_club AS (
    UPDATE
        club
    SET
        count_members = count_members + 1
    FROM
        inserted_person_club
    WHERE
        inserted_person_club.club_name = club.name
)
SELECT
    1
FROM
    existing_or_inserted_club
LIMIT 1
"""

Q_LEAVE_CLUB = """
WITH deleted_person_club AS (
    DELETE FROM
        person_club
    WHERE
        person_id = %(person_id)s
    AND
        club_name = %(club_name)s
    RETURNING
        club_name
)
UPDATE
    club
SET
    count_members = GREATEST(0, count_members - 1)
WHERE
    name = %(club_name)s
AND
    EXISTS (SELECT 1 FROM deleted_person_club)
"""

# Club SEO page queries. The heavy aggregation lives in the cron package
# (service/cron/clubseo/sql); these are the single-row reads.

# Gated on the live member threshold (not the cached club_stats row) so a
# club that's dropped below it 404s immediately rather than waiting for
# the cron to clean up.
#
# Related clubs are ranked live (lift = n*N/(|A|*|B|), which reduces to
# n/|B| for a fixed A) so the list stays fresh between overlap rebuilds.
Q_CLUB_PAGE_READ = f"""
SELECT
    cs.stats_json,
    seo.description,
    COALESCE(cta.answers_json, '[]'::jsonb) AS top_answers,
    COALESCE(rel.j, '[]'::json) AS related_clubs
FROM
    club c
JOIN
    club_stats cs ON cs.club_name = c.name
LEFT JOIN
    club_seo seo ON seo.club_name = c.name
LEFT JOIN
    club_top_answers cta ON cta.club_name = c.name
LEFT JOIN LATERAL (
    SELECT json_agg(
        json_build_object(
            'name',          club_b,
            'count_members', count_members_b,
            'overlap',       overlap
        )
        ORDER BY score DESC
    ) AS j
    FROM (
        SELECT
            co.club_b,
            co.count_members_b,
            co.overlap,
            co.overlap::float8 / co.count_members_b AS score
        FROM
            club_overlap co
        WHERE
            co.club_a = c.name
        AND
            co.count_members_b >= {MIN_CLUB_PAGE_MEMBERS}
        ORDER BY
            score DESC
        LIMIT {MAX_RELATED_CLUBS}
    ) ranked
) rel ON TRUE
WHERE
    c.name = %(club_name)s
AND
    c.count_members >= {MIN_CLUB_PAGE_MEMBERS}
"""

Q_UPDATE_CHATS_NOTIFICATIONS = """
WITH updated_rows AS (
    UPDATE
        person
    SET
        chats_notification = immediacy.id
    FROM
        immediacy
    WHERE
        person.email = %(email)s
    AND
        immediacy.name = %(frequency)s
    RETURNING 1
)
SELECT
    count(*) > 0 AS ok
FROM
    updated_rows
"""

Q_UPDATE_INTROS_NOTIFICATIONS = """
WITH updated_rows AS (
    UPDATE
        person
    SET
        intros_notification = immediacy.id
    FROM
        immediacy
    WHERE
        person.email = %(email)s
    AND
        immediacy.name = %(frequency)s
    RETURNING 1
)
SELECT
    count(*) > 0 AS ok
FROM
    updated_rows
"""

Q_CHECK_ADMIN_BAN_TOKEN = """
SELECT 1 FROM banned_person_admin_token WHERE token = %(token)s
"""

Q_ADMIN_BAN = """
WITH deleted_token AS (
    DELETE FROM
        banned_person_admin_token
    WHERE
        token = %(token)s
    AND
        expires_at > NOW()
    RETURNING
        person_id
), this_banned_person AS (
    SELECT
        normalized_email,
        uuid AS person_uuid,
        id AS person_id
    FROM
        person
    JOIN
        deleted_token
    ON
        deleted_token.person_id = person.id
), report_reason AS (
    SELECT
        COALESCE(array_agg(report_reason), ARRAY[]::text[]) AS report_reasons
    FROM
        skipped
    WHERE
        reported
    AND
        object_person_id = (SELECT person_id FROM deleted_token)
    AND
        report_reason <> ''
), _duo_session AS (
    SELECT
        this_banned_person.normalized_email AS normalized_email,
        COALESCE(duo_session.ip_address, '127.0.0.1') AS ip_address
    FROM
        this_banned_person
    LEFT JOIN
        duo_session
    ON
        duo_session.person_id = this_banned_person.person_id
), banned_person_insertion AS (
    INSERT INTO banned_person (
        normalized_email,
        ip_address,
        report_reasons
    )
    SELECT
        normalized_email,
        ip_address,
        report_reasons
    FROM
        _duo_session,
        report_reason
    ON CONFLICT DO NOTHING
)
SELECT
    person_id,
    person_uuid::TEXT
FROM
    this_banned_person
"""

Q_CHECK_ADMIN_DELETE_PHOTO_TOKEN = """
SELECT 1 FROM deleted_photo_admin_token WHERE token = %(token)s
"""

Q_ADMIN_DELETE_PHOTO = """
WITH deleted_token AS (
    DELETE FROM
        deleted_photo_admin_token
    WHERE
        token = %(token)s
    AND
        expires_at > NOW()
    RETURNING
        photo_uuid
), deleted_photo AS (
    DELETE FROM
        photo
    USING
        deleted_token
    WHERE
        photo.uuid = deleted_token.photo_uuid
    RETURNING
        photo.uuid,
        photo.hash,
        photo.person_id
), deleted_person_event AS (
    UPDATE
        person
    SET
        last_event_time = sign_up_time,
        last_event_name = 'joined',
        last_event_data = '{}'
    WHERE
        id = (SELECT person_id FROM deleted_photo)
    AND
        (last_event_data->>'added_photo_uuid')::TEXT = (
            SELECT
                uuid
            FROM
                deleted_photo
        )
), inserted_undeleted_photo AS (
    INSERT INTO undeleted_photo (
        uuid
    )
    SELECT
        uuid
    FROM
        deleted_photo
    RETURNING
        uuid
), inserted_banned_photo_hash AS (
    INSERT INTO banned_photo_hash (
        hash
    )
    SELECT
        hash
    FROM
        deleted_photo
    WHERE
        hash <> ''
    ON CONFLICT DO NOTHING
)
SELECT
    inserted_undeleted_photo.uuid,
    deleted_photo.person_id
FROM
    inserted_undeleted_photo
JOIN
    deleted_photo
ON
    inserted_undeleted_photo.uuid = deleted_photo.uuid
"""

Q_STATS = """
SELECT
    count(*) AS num_active_users
FROM
    person
WHERE
    activated
"""

Q_STATS_BY_CLUB_NAME = """
SELECT
    COALESCE(SUM(count_members), 0) AS num_active_users
FROM
    club
WHERE
    name = %(club_name)s
"""

Q_GENDER_STATS = """
SELECT
    count(*) FILTER (WHERE activated AND gender_id = 1)::real /
    count(*) FILTER (WHERE activated AND gender_id = 2)::real
    AS gender_ratio,

    count(*) FILTER (WHERE activated AND gender_id NOT IN (1, 2))::real /
    count(*) FILTER (WHERE activated)::real *
    100.0
    AS non_binary_percentage
FROM
    person
"""

Q_PERSON_ID_TO_UUID = """
SELECT
    uuid::text
FROM
    person
WHERE
    id = %(person_id)s
"""

Q_ADMIN_TOKEN_TO_UUID = """
SELECT
    person.uuid::text AS person_uuid
FROM
    person
JOIN
    banned_person_admin_token
ON
    banned_person_admin_token.person_id = person.id
WHERE
    banned_person_admin_token.token = %(token)s
"""

Q_DELETE_VERIFICATION_JOB = """
WITH deleted_job AS (
    DELETE FROM
        verification_job
    WHERE
        person_id = %(person_id)s
    RETURNING
        photo_uuid AS uuid
)
INSERT INTO undeleted_photo (
    uuid
)
SELECT
    uuid
FROM
    deleted_job
"""

Q_INSERT_VERIFICATION_JOB = """
INSERT INTO verification_job (
    person_id,
    photo_uuid
) VALUES (
    %(person_id)s,
    %(photo_uuid)s
)
"""

Q_INSERT_VERIFICATION_PHOTO_HASH = """
INSERT INTO verification_photo_hash (
    hash
)
VALUES
    (%(photo_hash)s)
ON CONFLICT DO NOTHING
RETURNING
    1
"""

Q_UPDATE_VERIFICATION_JOB = """
UPDATE
    verification_job
SET
    status = %(status)s,
    message = %(message)s
WHERE
    person_id = %(person_id)s
AND (
        status = %(expected_previous_status)s
    OR
        %(expected_previous_status)s::verification_job_status IS NULL
)
"""

Q_CHECK_VERIFICATION = """
SELECT
    person.verified_gender,
    person.verified_age,
    person.verified_ethnicity,
    (
        SELECT json_object_agg(position, verified) AS j
        FROM photo
        WHERE person_id = %(person_id)s
    ) AS verified_photos,
    verification_job.status,
    verification_job.message
FROM
    person
LEFT JOIN
    verification_job
ON
    verification_job.person_id = person.id
WHERE
    person.id = %(person_id)s
"""

Q_INSERT_EXPORT_DATA_TOKEN = """
INSERT INTO export_data_token (
    person_id
)
VALUES
    (%(person_id)s)
RETURNING
    token
"""

Q_CHECK_EXPORT_DATA_TOKEN = """
WITH deleted_export_data_token AS (
    DELETE FROM
        export_data_token
    WHERE
        token = %(token)s
    AND
        expires_at > NOW()
    RETURNING
        person_id
)
SELECT
    person.id AS person_id,
    person.uuid AS person_uuid
FROM
    person
JOIN
    deleted_export_data_token
ON
    deleted_export_data_token.person_id = person.id
"""

Q_EXPORT_API_DATA = """
SELECT json_build_object(
    'person', (
        SELECT
            -- `shadow_banned_at` is stripped: a shadow-banned user's own export
            -- must not reveal the ban.
            json_agg(to_jsonb(t) - 'shadow_banned_at')
        FROM (
            SELECT
                person.*,
                gender.name AS gender_name,
                has_profile_picture.name AS has_profile_picture_name,
                verification_level.name AS verification_level_name,
                orientation.name AS orientation_name,
                ethnicity.name AS ethnicity_name,
                looking_for.name AS looking_for_name,
                smoking.name AS smoking_name,
                drinking.name AS drinking_name,
                drugs.name AS drugs_name,
                long_distance.name AS long_distance_name,
                relationship_status.name AS relationship_status_name,
                has_kids.name AS has_kids_name,
                wants_kids.name AS wants_kids_name,
                exercise.name AS exercise_name,
                religion.name AS religion_name,
                star_sign.name AS star_sign_name,
                unit.name AS unit_name,
                chats_notification.name AS chats_notification_name,
                intros_notification.name AS intros_notification_name,
                privacy_verification_level.name AS privacy_verification_level_name
            FROM
                person
            LEFT JOIN
                gender ON
                gender.id = gender_id
            LEFT JOIN
                yes_no AS
                has_profile_picture ON
                has_profile_picture.id = has_profile_picture_id
            LEFT JOIN
                verification_level ON
                verification_level.id = verification_level_id
            LEFT JOIN
                orientation ON
                orientation.id = person.id
            LEFT JOIN
                ethnicity ON
                ethnicity.id = ethnicity_id
            LEFT JOIN
                looking_for ON
                looking_for.id = looking_for_id
            LEFT JOIN
                yes_no_optional AS
                smoking ON
                smoking.id = smoking_id
            LEFT JOIN
                frequency AS
                drinking ON
                drinking.id = drinking_id
            LEFT JOIN
                yes_no_optional AS
                drugs ON
                drugs.id = drugs_id
            LEFT JOIN
                yes_no_optional AS
                long_distance ON
                long_distance.id = long_distance_id
            LEFT JOIN
                yes_no_optional AS
                relationship_status ON
                relationship_status.id = relationship_status_id
            LEFT JOIN
                yes_no_optional AS
                has_kids ON
                has_kids.id = has_kids_id
            LEFT JOIN
                yes_no_maybe AS
                wants_kids ON
                wants_kids.id = wants_kids_id
            LEFT JOIN
                frequency AS
                exercise ON
                exercise.id = exercise_id
            LEFT JOIN
                religion ON
                religion.id = religion_id
            LEFT JOIN
                star_sign ON
                star_sign.id = star_sign_id
            LEFT JOIN
                unit ON
                unit.id = unit_id
            LEFT JOIN
                immediacy AS
                chats_notification ON
                chats_notification.id = person.chats_notification
            LEFT JOIN
                immediacy AS
                intros_notification ON
                intros_notification.id = person.intros_notification
            LEFT JOIN
                verification_level AS
                privacy_verification_level ON
                privacy_verification_level.id = person.privacy_verification_level_id

            WHERE
                person.id = %(person_id)s
        ) AS t
    ),

    'photo', (
        SELECT
            json_agg(row_to_json(t))
        FROM (
            SELECT
                *,

                'https://user-images.duolicious.app/original-' ||
                    uuid ||
                    '.jpg' AS photo_url

            FROM
                photo
            WHERE
                person_id = %(person_id)s
            ORDER BY
                position
        ) AS t
    ),

    'answer', (
        SELECT
            json_agg(row_to_json(t))
        FROM (
            SELECT
                question.id,
                question.question,
                answer.answer,
                answer.public_
            FROM
                answer
            JOIN
                question
            ON
                question.id = question_id
            WHERE
                person_id = %(person_id)s
        ) AS t
    ),

    'verification_job', (
        SELECT
            json_agg(row_to_json(t))
        FROM (
            SELECT
                *,

                'https://user-images.duolicious.app/450-' ||
                    photo_uuid ||
                    '.jpg' AS photo_url
            FROM
                verification_job
            WHERE
                person_id = %(person_id)s
        ) AS t
    ),

    'person_club', (
        SELECT
            json_agg(row_to_json(person_club))
        FROM
            person_club
        WHERE
            person_id = %(person_id)s
    ),

    'skipped', (
        SELECT
            json_agg(row_to_json(skipped))
        FROM
            skipped
        WHERE
            subject_person_id = %(person_id)s
    ),

    'messaged', (
        SELECT
            json_agg(row_to_json(messaged))
        FROM
            messaged
        WHERE
            subject_person_id = %(person_id)s
    ),

    'mam_message', (
        SELECT
            json_agg(row_to_json(mam_message))
        FROM
            mam_message
        WHERE
            person_id = %(person_id)s
    ),

    'presence_histogram', (
        SELECT
            json_agg(row_to_json(presence_histogram))
        FROM
            presence_histogram
        WHERE
            person_id = %(person_id)s
    )

) AS j
"""

Q_GET_SESSION_CLUBS = """
SELECT
    COALESCE(
        (
            SELECT
                json_agg(
                    json_build_object(
                        'name',
                        person_club.club_name,

                        'count_members',
                        -1,

                        'search_preference',
                        person_club.club_name IS NOT DISTINCT FROM search_preference_club.club_name
                    )
                    ORDER BY
                        person_club.club_name
                )
            FROM
                person_club
            LEFT JOIN
                search_preference_club
            ON
                search_preference_club.person_id = person_club.person_id
            WHERE
                person_club.person_id = %(person_id)s
        ),
        '[]'::json
    ) AS clubs,
    (
        SELECT
            json_build_object(
                'name',
                %(pending_club_name)s::TEXT,

                'count_members',
                (
                    SELECT
                        coalesce(sum(count_members), 0)
                    FROM
                        club
                    WHERE
                        name = %(pending_club_name)s
                )
            )
        WHERE
            %(pending_club_name)s::TEXT IS NOT NULL
    ) AS pending_club
"""

Q_MESSAGE_STATS = """
WITH message_sent AS (
    SELECT
        object_person_id AS other_person_id,
        created_at AS message_sent_at
    FROM
        messaged
    JOIN
        person
    ON
        person.id = messaged.subject_person_id
    WHERE
        person.uuid = %(prospect_uuid)s
), message_received AS (
    SELECT
        subject_person_id AS other_person_id,
        created_at AS message_received_at
    FROM
        messaged
    JOIN
        person
    ON
        person.id = messaged.object_person_id
    WHERE
        person.uuid = %(prospect_uuid)s
), conversation AS (
    SELECT
        message_sent_at,
        message_received_at
    FROM
        message_sent
    FULL OUTER JOIN
        message_received USING (other_person_id)
), absolute_numbers AS (
    SELECT
        count(*) FILTER (
            WHERE message_sent_at <= message_received_at)::real
            AS num_intros_sent_with_reply,

        count(*) FILTER (
            WHERE message_sent_at <= message_received_at
            OR message_received_at IS NULL)::real
            AS num_intros_sent,

        count(*) FILTER (
            WHERE message_received_at <= message_sent_at)::real
            AS num_intros_received_with_reply,

        count(*) FILTER (
            WHERE message_received_at <= message_sent_at
            OR message_sent_at IS NULL)::real
            AS num_intros_received
    FROM
        conversation
), is_account_new AS (
    SELECT
        sign_up_time > now() - interval '1 day' AS value
    FROM
        person
    WHERE
        person.uuid = %(prospect_uuid)s
)
SELECT
    CASE
        WHEN (SELECT value FROM is_account_new)
        THEN NULL

        WHEN num_intros_sent < 5
        THEN NULL

        ELSE ROUND(num_intros_sent_with_reply / num_intros_sent * 100)
    END AS gets_reply_percentage,

    CASE
        WHEN (SELECT value FROM is_account_new)
        THEN NULL

        WHEN num_intros_received < 5
        THEN NULL

        ELSE ROUND(num_intros_received_with_reply / num_intros_received * 100)
    END AS gives_reply_percentage
FROM
    absolute_numbers
"""

Q_HAS_GOLD = """
SELECT
    has_gold
FROM
    person
WHERE
    id = %(person_id)s
"""

Q_SELECT_REVENUECAT_AUTHORIZED = """
SELECT
    1
FROM
    funding
WHERE
    token_hash_revenuecat = %(token_hash_revenuecat)s
"""

Q_UPDATE_GOLD_FROM_REVENUECAT = f"""
WITH updated_person_with_gold AS (
    UPDATE
        person
    SET
        has_gold = TRUE
    WHERE
        person.uuid = uuid_or_null(%(person_uuid)s::TEXT)
    AND
        %(has_gold)s = TRUE
    RETURNING
        person.uuid
), updated_person_without_gold AS (
    UPDATE
        person
    SET
        has_gold = FALSE,

        title_color = DEFAULT,
        body_color = DEFAULT,
        background_color = DEFAULT,

        show_my_location = DEFAULT,
        show_my_age = DEFAULT,
        show_my_looking_for = DEFAULT,
        hide_me_from_strangers = DEFAULT,
        browse_invisibly = DEFAULT
    WHERE
        person.uuid = uuid_or_null(%(person_uuid)s::TEXT)
    AND
        %(has_gold)s = FALSE
    RETURNING
        person.uuid
), updated_person AS (
    SELECT uuid FROM updated_person_with_gold
    UNION
    SELECT uuid FROM updated_person_without_gold
), ranked_person_club AS (
    SELECT
        person_club.person_id,
        person_club.club_name,
        ROW_NUMBER() OVER (ORDER BY club.count_members ASC, club.name ASC) AS rn
    FROM
        person_club
    JOIN
        club
    ON
        club.name = person_club.club_name
    JOIN
        person
    ON
        person.id = person_club.person_id
    WHERE
        person.uuid = uuid_or_null(%(person_uuid)s::TEXT)
), deleted_person_club AS (
    DELETE FROM
        person_club
    USING
        ranked_person_club
    WHERE
        person_club.person_id = ranked_person_club.person_id
    AND
        person_club.club_name = ranked_person_club.club_name
    AND
        ranked_person_club.rn > CASE
            WHEN %(has_gold)s
            THEN {CLUB_QUOTA_GOLD}
            ELSE {CLUB_QUOTA_FREE}
        END
    RETURNING
        person_club.club_name
), updated_club AS (
    UPDATE
        club
    SET
        count_members = club.count_members - 1
    FROM
        deleted_person_club
    WHERE
        club.name = deleted_person_club.club_name
)
SELECT
    uuid as person_uuid
FROM
    updated_person
"""


# ---------------------------------------------------------------------------
# Social login (Google / Apple)
# ---------------------------------------------------------------------------

# True when the caller is currently banned, by either normalized email
# or IP. Used by both /request-otp and the social sign-in path as the
# first statement inside their api_tx() block; the OTP-issuing /
# session-issuing query then runs against the same snapshot.
#
# We don't repeat the bad_email_domain check here because Apple/Google
# already gate disposable providers, and Apple's
# @privaterelay.appleid.com would otherwise trip an overzealous filter.
# The OTP path keeps that filter inside `_OTP_CTE` for new sign-ups.
Q_IS_BANNED = """
SELECT 1
WHERE EXISTS (
    SELECT 1
    FROM banned_person
    WHERE
        (normalized_email = %(normalized_email)s OR ip_address = %(ip_address)s)
    AND
        expires_at > NOW()
)
"""

# Look up a linked person by provider sub. Excludes bots — a bot account
# returning here would bypass the bot check that the OTP path performs.
Q_LOOKUP_SOCIAL_IDENTITY = """
SELECT
    person.id AS person_id
FROM
    social_identity
JOIN
    person ON person.id = social_identity.person_id
WHERE
    social_identity.provider = %(provider)s
AND
    social_identity.provider_sub = %(provider_sub)s
AND
    NOT 'bot' = ANY(person.roles)
"""

# Auto-link path: find a person by normalized_email so a verified social
# email can claim an existing OTP-only account without an OTP round-trip.
# Matches `Q_INSERT_DUO_SESSION`'s tiebreaker (prefer exact-case email).
Q_LOOKUP_PERSON_BY_EMAIL = """
SELECT
    id AS person_id
FROM
    person
WHERE
    normalized_email = %(normalized_email)s
AND
    NOT 'bot' = ANY(roles)
ORDER BY
    email = %(email)s DESC,
    email
LIMIT 1
"""

Q_INSERT_SOCIAL_IDENTITY = """
INSERT INTO social_identity (
    provider,
    provider_sub,
    person_id,
    email
) VALUES (
    %(provider)s,
    %(provider_sub)s,
    %(person_id)s,
    %(email)s
)
ON CONFLICT (provider, provider_sub) DO NOTHING
"""

# Create the onboardee row for a brand-new social sign-up. The user picks
# their display name later in the onboarding wizard — we deliberately
# don't seed it from the provider.
Q_UPSERT_ONBOARDEE_FOR_SOCIAL = """
INSERT INTO onboardee (email)
VALUES (%(email)s)
ON CONFLICT (email) DO NOTHING
"""

# Insert an already-signed-in session. `pending_social_*` are non-null only
# when this session belongs to a brand-new user who still has to complete
# onboarding — `Q_FINISH_ONBOARDING` drains them into `social_identity`.
Q_INSERT_DUO_SESSION_SOCIAL = """
INSERT INTO duo_session (
    session_token_hash,
    person_id,
    email,
    pending_club_name,
    ip_address,
    signed_in,
    pending_social_provider,
    pending_social_sub
) VALUES (
    %(session_token_hash)s,
    %(person_id)s,
    %(email)s,
    %(pending_club_name)s,
    %(ip_address)s,
    TRUE,
    %(pending_social_provider)s,
    %(pending_social_sub)s
)
"""

Q_AFTER_SOCIAL_SIGN_IN = f"""
WITH existing_person_before_update AS (
    SELECT
        id,
        activated
    FROM
        person
    WHERE
        id = %(person_id)s
), {_Q_POST_SIGN_IN_CTES}
SELECT
    existing_person.id AS person_id,
    existing_person.person_uuid,
    existing_person.has_gold,
    (SELECT name FROM unit WHERE id = existing_person.unit_id) AS units,
    {_Q_DO_SHOW_DONATION_NAG.format(table='existing_person')},
    {_Q_ESTIMATED_END_DATE},
    existing_person.name AS name
FROM
    existing_person
"""

# After a brand-new user finishes onboarding, drain the pending social
# identity from `duo_session` into `social_identity`. Run inside the same
# transaction as `Q_FINISH_ONBOARDING`, after the new `person` row exists.
Q_PROMOTE_PENDING_SOCIAL_IDENTITY = """
INSERT INTO social_identity (provider, provider_sub, person_id, email)
SELECT
    duo_session.pending_social_provider,
    duo_session.pending_social_sub,
    %(person_id)s,
    duo_session.email
FROM
    duo_session
WHERE
    duo_session.session_token_hash = %(session_token_hash)s
AND
    duo_session.pending_social_provider IS NOT NULL
AND
    duo_session.pending_social_sub IS NOT NULL
ON CONFLICT (provider, provider_sub) DO NOTHING
"""
