from constants import ONLINE_RECENTLY_SECONDS
from commonsql import Q_COMPUTED_FLAIR
from qanda import ANSWER_VISIBLE_TO_OTHERS

# How many feed results to send to the client per request
FEED_RESULTS_PER_PAGE = 50

# The inverse of the proportion of feed results to discard.
FEED_SELECTIVITY = 2

# How many members to send for a feed item's facepile. For an
# `answered-question` item's "yes" and "no" piles, mobile clients only show
# the first 3 because the two piles share the card's width.
FEED_FACEPILE_SIZE = 5

# How many candidate members to consider for a facepile. Bounds the work done
# per feed item when the club or question is huge.
FEED_FACEPILE_POOL = 50


def _facepile(pool: str, member_condition: str = 'TRUE') -> str:
    """
    A `jsonb_agg` of up to `FEED_FACEPILE_SIZE` members drawn from `pool`, a
    subquery yielding at most `FEED_FACEPILE_POOL` candidate `person_id`s.
    Members the searcher isn't allowed to see are filtered here, so `pool`
    doesn't have to get that right; `member_condition` may extend the filter
    with per-event-type conditions on `member`. Evaluated as a lateral join
    within `Q_FEED_V2`, where `feed_page` and `searcher` are in scope.
    """
    return f"""
        SELECT
            jsonb_agg(
                jsonb_build_object(
                    'person_uuid', facepile_member.person_uuid,
                    'url_slug', facepile_member.url_slug,
                    'photo_uuid', facepile_member.photo_uuid,
                    'photo_blurhash', facepile_member.photo_blurhash
                )
                ORDER BY
                    facepile_member.is_subject DESC,
                    facepile_member.matches_gender_preference DESC,
                    facepile_member.last_online_time DESC
            ) AS j
        FROM (
            SELECT
                member.uuid AS person_uuid,
                member.url_slug,
                member_photo.uuid AS photo_uuid,
                member_photo.blurhash AS photo_blurhash,
                member.last_online_time,
                member.id = feed_page.id AS is_subject,
                EXISTS (
                    SELECT
                        1
                    FROM
                        search_preference_gender AS preference
                    WHERE
                        preference.person_id = searcher.searcher_id
                    AND
                        preference.gender_id = member.gender_id
                ) AS matches_gender_preference
            FROM (
                -- The event's subject always leads the facepile (see the
                -- ORDER BY below), even when `pool`'s own LIMIT would have
                -- dropped them, so their face is guaranteed a slot.
                -- `feed_page` is the current lateral row, so this is the one
                -- subject, not the whole page
                ( SELECT feed_page.id AS person_id )

                UNION

                ( {pool} )
            ) AS pool
            JOIN
                person AS member
            ON
                member.id = pool.person_id
            JOIN LATERAL (
                SELECT
                    photo.uuid,
                    photo.blurhash
                FROM
                    photo
                WHERE
                    photo.person_id = member.id
                ORDER BY
                    photo.position
                LIMIT 1
            ) AS member_photo
            ON TRUE
            WHERE
                -- The searcher is already in the payload as the viewer entry
                -- (club_viewer/question_viewer), so including them here would
                -- double them up
                member.id <> searcher.searcher_id
            AND (
                {member_condition}
            )
            AND (
                -- The event's subject is already shown as the item's hero
                -- avatar, so their visibility was settled upstream. Re-running
                -- the pile's per-member visibility checks on them would drop
                -- subjects who hide from strangers, aren't verified, etc.,
                -- defeating the slot they're guaranteed
                member.id = feed_page.id
            OR (
                    member.shadow_banned_at IS NULL
                AND
                    NOT member.hide_me_from_strangers
                AND
                    -- The member did not skip the searcher; their profile
                    -- would be inaccessible if they did
                    NOT EXISTS (
                        SELECT
                            1
                        FROM
                            skipped
                        WHERE
                            skipped.subject_person_id = member.id
                        AND
                            skipped.object_person_id = searcher.searcher_id
                    )
                AND
                    member.privacy_verification_level_id <=
                        searcher.verification_level_id
                AND (
                        member.verification_level_id > 1
                    OR
                        NOT member.verification_required
                )
            ))
            ORDER BY
                -- The event's subject leads, so the frontend can seat their
                -- face closest to the card's centre
                member.id = feed_page.id DESC,
                matches_gender_preference DESC,
                member.last_online_time DESC
            LIMIT
                {FEED_FACEPILE_SIZE}
        ) AS facepile_member
    """


def _club_facepile() -> str:
    """
    The facepile for a 'joined-club' feed item; `club` is in scope at the
    call site.
    """
    return _facepile(f"""
                SELECT
                    person_id
                FROM
                    person_club
                WHERE
                    person_club.club_name = club.name
                AND
                    person_club.activated
                ORDER BY
                    person_club.person_id DESC
                LIMIT
                    {FEED_FACEPILE_POOL}
    """)


def _question_facepile(answer: bool) -> str:
    """
    The facepile of people who publicly answered `question.id` with `answer`;
    `question` is in scope at the call site.
    """
    return _facepile(
        f"""
                SELECT
                    person_id
                FROM
                    answer
                WHERE
                    answer.question_id = question.id
                AND
                    answer.public_
                AND
                    answer.answer = {'TRUE' if answer else 'FALSE'}
                ORDER BY
                    answer.person_id DESC
                LIMIT
                    {FEED_FACEPILE_POOL}
        """,
        member_condition=f"""
                -- Unlike `person_club` rows, `answer` rows aren't deactivated
                -- with the account, so members must be filtered here
                member.activated
            AND
                -- `pool` already answered this way, but the unioned subject
                -- hasn't been checked, so re-assert it here to keep them out
                -- of the pile that doesn't match their answer
                EXISTS (
                    SELECT
                        1
                    FROM
                        answer
                    WHERE
                        answer.person_id = member.id
                    AND
                        answer.question_id = question.id
                    AND
                        answer.public_
                    AND
                        answer.answer = {'TRUE' if answer else 'FALSE'}
                )
        """,
    )



Q_UPSERT_SEARCH_PREFERENCE_CLUB = """
INSERT INTO search_preference_club (
    person_id,
    club_name
)
SELECT
    %(person_id)s,
    %(club_name)s::TEXT
WHERE
    %(club_name)s::TEXT IS NOT NULL
AND
    %(do_modify)s
ON CONFLICT (person_id) DO UPDATE SET
    club_name = EXCLUDED.club_name
"""



Q_SEARCH_PREFERENCE = f"""
WITH delete_search_preference_club AS (
    DELETE FROM
        search_preference_club
    WHERE
        person_id = %(person_id)s
    AND
        %(club_name)s::TEXT IS NULL
    AND
        %(do_modify)s
), set_pending_club_name_to_null AS (
    UPDATE
        duo_session
    SET
        pending_club_name = NULL
    WHERE
        person_id = %(person_id)s
), upsert_search_preference_club AS (
    {Q_UPSERT_SEARCH_PREFERENCE_CLUB}
)
SELECT
    gender_id
FROM
    search_preference_gender
WHERE
    person_id = %(person_id)s
"""



Q_UNCACHED_SEARCH_1 = """
DELETE FROM
    search_cache
WHERE
    searcher_person_id = %(searcher_person_id)s
"""



# The searcher's filter predicates (except club membership) are mirrored (by
# hand) by the `matches_search_filters` column of the inbox snapshot query in
# `service.api.chat.messagestorage.inbox`, which flags intros from senders outside
# the viewer's search filters. If a filter is added or changed here, change it
# there too. (A unit test beside the inbox query fails when a
# `search_preference_*` table is consulted by one query and not the other.)
Q_UNCACHED_SEARCH_2 = """
WITH searcher AS (
    SELECT
        coordinates,
        personality,
        gender_id,
        COALESCE(
            (
                SELECT
                    1000 * distance
                FROM
                    search_preference_distance
                WHERE
                    person_id = %(searcher_person_id)s
            ),
            1e9
        ) AS distance_preference,
        (
            SELECT
                club_name
            FROM
                search_preference_club
            WHERE
                person_id = %(searcher_person_id)s
        ) AS club_preference,
        count_answers,
        -- The searcher's one-way (enum) preferences, fetched once here as
        -- arrays so the prospect filters below become cheap `= ANY(...)`
        -- membership tests instead of re-probing each preference table once
        -- per prospect.
        ARRAY(
            SELECT orientation_id FROM search_preference_orientation
            WHERE person_id = %(searcher_person_id)s
        ) AS orientation_preference,
        ARRAY(
            SELECT ethnicity_id FROM search_preference_ethnicity
            WHERE person_id = %(searcher_person_id)s
        ) AS ethnicity_preference,
        ARRAY(
            SELECT has_profile_picture_id FROM search_preference_has_profile_picture
            WHERE person_id = %(searcher_person_id)s
        ) AS has_profile_picture_preference,
        ARRAY(
            SELECT looking_for_id FROM search_preference_looking_for
            WHERE person_id = %(searcher_person_id)s
        ) AS looking_for_preference,
        ARRAY(
            SELECT smoking_id FROM search_preference_smoking
            WHERE person_id = %(searcher_person_id)s
        ) AS smoking_preference,
        ARRAY(
            SELECT drinking_id FROM search_preference_drinking
            WHERE person_id = %(searcher_person_id)s
        ) AS drinking_preference,
        ARRAY(
            SELECT drugs_id FROM search_preference_drugs
            WHERE person_id = %(searcher_person_id)s
        ) AS drugs_preference,
        ARRAY(
            SELECT long_distance_id FROM search_preference_long_distance
            WHERE person_id = %(searcher_person_id)s
        ) AS long_distance_preference,
        ARRAY(
            SELECT relationship_status_id FROM search_preference_relationship_status
            WHERE person_id = %(searcher_person_id)s
        ) AS relationship_status_preference,
        ARRAY(
            SELECT has_kids_id FROM search_preference_has_kids
            WHERE person_id = %(searcher_person_id)s
        ) AS has_kids_preference,
        ARRAY(
            SELECT wants_kids_id FROM search_preference_wants_kids
            WHERE person_id = %(searcher_person_id)s
        ) AS wants_kids_preference,
        ARRAY(
            SELECT exercise_id FROM search_preference_exercise
            WHERE person_id = %(searcher_person_id)s
        ) AS exercise_preference,
        ARRAY(
            SELECT religion_id FROM search_preference_religion
            WHERE person_id = %(searcher_person_id)s
        ) AS religion_preference,
        ARRAY(
            SELECT star_sign_id FROM search_preference_star_sign
            WHERE person_id = %(searcher_person_id)s
        ) AS star_sign_preference
    FROM
        person
    WHERE
        person.id = %(searcher_person_id)s
), prospects_first_pass_without_club AS (
    SELECT
        id
    FROM
        person AS prospect
    CROSS JOIN
        searcher
    WHERE
        prospect.activated
    AND
        -- The prospect meets the searcher's gender preference
        prospect.gender_id = ANY(%(gender_preference)s::SMALLINT[])
    AND
        -- The prospect meets the searcher's location preference
        ST_DWithin(
            prospect.coordinates,
            searcher.coordinates,
            searcher.distance_preference
        )
    AND
        searcher.club_preference IS NULL

    LIMIT
        30000
), prospects_first_pass_with_club AS (
    SELECT
        person_id AS id
    FROM
        person_club AS prospect
    CROSS JOIN
        searcher
    WHERE
        prospect.activated
    AND
        -- The prospect meets the searcher's gender preference
        prospect.gender_id = ANY(%(gender_preference)s::SMALLINT[])
    AND
        -- The prospect meets the searcher's location preference
        ST_DWithin(
            prospect.coordinates,
            searcher.coordinates,
            searcher.distance_preference
        )
    AND
        prospect.club_name = searcher.club_preference

    LIMIT
        30000
), prospects_second_pass AS (
    SELECT id FROM prospects_first_pass_without_club
    UNION ALL
    SELECT id FROM prospects_first_pass_with_club
), prospects_third_pass AS (
    SELECT
        prospect.id
    FROM
        person AS prospect
    JOIN
        prospects_second_pass
    ON
        prospects_second_pass.id = prospect.id
    CROSS JOIN
        searcher
    WHERE
        -- Shadow-banned prospects appear not to exist to other searchers. Done
        -- here (rather than in the per-source first passes) so the single
        -- `person` join covers both the club and non-club paths, and so
        -- person_club needn't carry the column.
        prospect.shadow_banned_at IS NULL
    ORDER BY
        prospect.personality <#> searcher.personality
    LIMIT
        10000
), prospects_fourth_pass AS (
    SELECT
        prospect.id AS prospect_person_id,

        uuid AS prospect_uuid,

        name,

        prospect.personality,

        verification_level_id > 1 AS verified,

        (
            SELECT
                uuid
            FROM
                photo
            WHERE
                person_id = prospect.id
            ORDER BY
                position
            LIMIT 1
        ) AS profile_photo_uuid,

        CASE
            WHEN show_my_age
            THEN EXTRACT(YEAR FROM AGE(prospect.date_of_birth))
            ELSE NULL
        END AS age,

        CLAMP(
            0,
            99,
            100 * (1 - (prospect.personality <#> searcher.personality)) / 2
        ) AS match_percentage,

        roles

    FROM
        person AS prospect
    JOIN
        prospects_third_pass
    ON
        prospects_third_pass.id = prospect.id
    CROSS JOIN
        searcher

    WHERE (
        -- The searcher meets the prospect's gender preference or
        -- the searcher is searching within a club
        EXISTS (
            SELECT
                1
            FROM
                search_preference_gender AS preference
            WHERE
                preference.person_id = prospect.id
            AND
                preference.gender_id = searcher.gender_id
        )
        OR searcher.club_preference IS NOT NULL
    )

   -- The prospect meets the searcher's age preference
    AND
        prospect.date_of_birth <= (
            SELECT
                CURRENT_DATE -
                INTERVAL '1 year' *
                COALESCE(min_age, 0)
            FROM
                search_preference_age
            WHERE
                person_id = %(searcher_person_id)s
        )::DATE
    AND
        prospect.date_of_birth > (
            SELECT
                CURRENT_DATE -
                INTERVAL '1 year' *
                (COALESCE(max_age, 999) + 1)
            FROM
                search_preference_age
            WHERE
                person_id = %(searcher_person_id)s
        )::DATE
    AND
        prospect.orientation_id = ANY(searcher.orientation_preference)
    AND
        prospect.ethnicity_id = ANY(searcher.ethnicity_preference)
    AND
        COALESCE(prospect.height_cm, 0) >= COALESCE(
            (
                SELECT
                    min_height_cm
                FROM
                    search_preference_height_cm
                WHERE
                    person_id = %(searcher_person_id)s
            ),
            0
        )
    AND
        COALESCE(prospect.height_cm, 999) <= COALESCE(
            (
                SELECT
                    max_height_cm
                FROM
                    search_preference_height_cm
                WHERE
                    person_id = %(searcher_person_id)s
            ),
            999
        )
    AND
        prospect.has_profile_picture_id = ANY(searcher.has_profile_picture_preference)
    AND
        prospect.looking_for_id = ANY(searcher.looking_for_preference)
    AND
        prospect.smoking_id = ANY(searcher.smoking_preference)
    AND
        prospect.drinking_id = ANY(searcher.drinking_preference)
    AND
        prospect.drugs_id = ANY(searcher.drugs_preference)
    AND
        prospect.long_distance_id = ANY(searcher.long_distance_preference)
    AND
        prospect.relationship_status_id = ANY(searcher.relationship_status_preference)
    AND
        prospect.has_kids_id = ANY(searcher.has_kids_preference)
    AND
        prospect.wants_kids_id = ANY(searcher.wants_kids_preference)
    AND
        prospect.exercise_id = ANY(searcher.exercise_preference)
    AND
        prospect.religion_id = ANY(searcher.religion_preference)
    AND
        prospect.star_sign_id = ANY(searcher.star_sign_preference)
    AND
        -- The prospect wants to be shown to strangers or isn't a stranger
        (
            prospect.id IN (
                SELECT
                    subject_person_id
                FROM
                    messaged
                WHERE
                    object_person_id = %(searcher_person_id)s
            )
        OR
            NOT prospect.hide_me_from_strangers
        )
    AND
        -- The prospect did not skip the searcher
        prospect.id NOT IN (
            SELECT
                subject_person_id
            FROM
                skipped
            WHERE
                object_person_id = %(searcher_person_id)s
        )
    AND
        -- The searcher did not skip the prospect, or the searcher wishes to
        -- view skipped prospects
        (
            prospect.id NOT IN (
                SELECT
                    object_person_id
                FROM
                    skipped
                WHERE
                    subject_person_id = %(searcher_person_id)s
            )
        OR
            1 IN (
                SELECT
                    skipped_id
                FROM
                    search_preference_skipped
                WHERE
                    person_id = %(searcher_person_id)s
            )
        )
    AND
        -- The searcher did not message the prospect, or the searcher wishes to
        -- view messaged prospects
        (
            prospect.id NOT IN (
                SELECT
                    object_person_id
                FROM
                    messaged
                WHERE
                    subject_person_id = %(searcher_person_id)s
            )
        OR
            1 IN (
                SELECT
                    messaged_id
                FROM
                    search_preference_messaged
                WHERE
                    person_id = %(searcher_person_id)s
            )
        )
    AND
        -- NOT EXISTS an answer contrary to the searcher's preference...
        NOT EXISTS (
            SELECT 1
            FROM (
                SELECT *
                FROM search_preference_answer
                WHERE person_id = %(searcher_person_id)s
            ) AS pref
            LEFT JOIN
                answer ans
            ON
                ans.person_id = prospect.id AND
                ans.question_id = pref.question_id
            WHERE
                -- Contrary because the answer exists and is wrong
                ans.answer IS NOT NULL AND
                ans.answer != pref.answer
            OR
                -- Contrary because the answer doesn't exist but should
                ans.answer IS NULL AND
                pref.accept_unanswered = FALSE
        )

    -- Exclude users who should be verified but aren't
    AND (
            prospect.verification_level_id > 1
        OR
            NOT prospect.verification_required
    )

    ORDER BY
        -- If this is changed, other subqueries will need changing too
        verified DESC,
        match_percentage DESC

    LIMIT
        -- 500 + 2. The two extra records are the searcher and the moderation
        -- bot, which we'll filter out later so that we have 500 records to show
        -- the user. We don't filer them here to reduce the number of checks we
        -- need to do for 'bot' or 'self' status.
        502
), do_promote_verified AS (
    SELECT
        count(*) >= 250 AS x
    FROM
        prospects_fourth_pass
    WHERE
        profile_photo_uuid IS NOT NULL
    AND
        verified
    AND
        (SELECT count_answers > 0 FROM searcher)
)
INSERT INTO search_cache (
    searcher_person_id,
    position,
    prospect_person_id,
    prospect_uuid,
    profile_photo_uuid,
    name,
    age,
    match_percentage,
    personality,
    verified
)
SELECT
    %(searcher_person_id)s,
    ROW_NUMBER() OVER (
        ORDER BY
            -- If this is changed, other subqueries will need changing too
            CASE
                WHEN (SELECT x FROM do_promote_verified)
                THEN
                    profile_photo_uuid IS NOT NULL AND verified
                ELSE
                    profile_photo_uuid IS NOT NULL
            END DESC,

            match_percentage DESC
    ) AS position,
    prospect_person_id,
    prospect_uuid,
    profile_photo_uuid,
    name,
    age,
    match_percentage,
    personality,
    verified
FROM
    prospects_fourth_pass
WHERE
    prospects_fourth_pass.prospect_person_id != %(searcher_person_id)s
AND
    'bot' <> ALL(prospects_fourth_pass.roles)
ORDER BY
    position
LIMIT
    500
ON CONFLICT (searcher_person_id, position) DO UPDATE SET
    searcher_person_id = EXCLUDED.searcher_person_id,
    position = EXCLUDED.position,
    prospect_person_id = EXCLUDED.prospect_person_id,
    prospect_uuid = EXCLUDED.prospect_uuid,
    profile_photo_uuid = EXCLUDED.profile_photo_uuid,
    name = EXCLUDED.name,
    age = EXCLUDED.age,
    match_percentage = EXCLUDED.match_percentage,
    personality = EXCLUDED.personality,
    verified = EXCLUDED.verified
"""



Q_CACHED_SEARCH = """
WITH page AS (
    SELECT
        prospect_person_id,
        prospect_uuid,
        (
            SELECT url_slug FROM person WHERE id = prospect_person_id
        ) AS url_slug,
        profile_photo_uuid,
        (
            SELECT blurhash FROM photo WHERE profile_photo_uuid = photo.uuid
        ) AS profile_photo_blurhash,
        name,
        age,
        match_percentage,
        EXISTS (
            SELECT
                1
            FROM
                messaged
            WHERE
                subject_person_id = %(searcher_person_id)s
            AND
                object_person_id = prospect_person_id
        ) AS person_messaged_prospect,
        EXISTS (
            SELECT
                1
            FROM
                messaged
            WHERE
                subject_person_id = prospect_person_id
            AND
                object_person_id = %(searcher_person_id)s
        ) AS prospect_messaged_person,
        verified,
        (
            SELECT
                verification_level_id
            FROM
                person
            WHERE
                id = %(searcher_person_id)s
        ) AS searcher_verification_level_id,
        (
            SELECT
                privacy_verification_level_id
            FROM
                person
            WHERE
                id = prospect_person_id
        ) AS privacy_verification_level_id
    FROM
        search_cache
    WHERE
        searcher_person_id = %(searcher_person_id)s AND
        position >  %(o)s AND
        position <= %(o)s + %(n)s
    ORDER BY
        position
)
SELECT
    public_page.profile_photo_blurhash,
    public_page.name,
    public_page.age,
    public_page.match_percentage,
    public_page.person_messaged_prospect,
    public_page.prospect_messaged_person,
    public_page.verified,
    public_page.verification_required_to_view,

    private_page.prospect_person_id,
    private_page.prospect_uuid,
    private_page.url_slug,
    private_page.profile_photo_uuid
FROM
    (
        SELECT
            *,

            CASE
                WHEN
                    searcher_verification_level_id >=
                    privacy_verification_level_id
                THEN NULL
                WHEN
                    privacy_verification_level_id = 2
                THEN 'basics'
                WHEN
                    privacy_verification_level_id = 3
                THEN 'photos'
            END AS verification_required_to_view
        FROM
            page
    ) AS public_page
LEFT JOIN
    (
        SELECT
            *
        FROM
            page
        WHERE
            searcher_verification_level_id >= privacy_verification_level_id
    ) AS private_page
ON
    private_page.prospect_person_id = public_page.prospect_person_id
"""

Q_PUBLIC_SEARCH = """
SELECT
    prospect.id AS prospect_person_id,

    prospect.uuid AS prospect_uuid,

    prospect.url_slug,

    prospect.name,

    prospect.verification_level_id > 1 AS verified,

    (
        SELECT
            uuid
        FROM
            photo
        WHERE
            person_id = prospect.id
        ORDER BY
            position
        LIMIT 1
    ) AS profile_photo_uuid,

    (
        SELECT
            blurhash
        FROM
            photo
        WHERE
            person_id = prospect.id
        ORDER BY
            position
        LIMIT 1
    ) AS profile_photo_blurhash,

    CASE
        WHEN prospect.show_my_age
        THEN EXTRACT(YEAR FROM AGE(prospect.date_of_birth))
        ELSE NULL
    END AS age,

    50 AS match_percentage,

    FALSE AS person_messaged_prospect,

    FALSE AS prospect_messaged_person,

    NULL AS verification_required_to_view
FROM
    person AS prospect
WHERE
    prospect.public_profile
AND
    prospect.activated
AND
    prospect.shadow_banned_at IS NULL
AND ( -- Exclude users who should be verified but aren't
        prospect.verification_level_id > 1
    OR
        NOT prospect.verification_required
)
AND
    prospect.last_online_time > now() - interval '7 days'
ORDER BY
    (
        SELECT
            count(*)
        FROM
            messaged
        WHERE
            object_person_id = prospect.id
    ) DESC,
    prospect.id
"""

# Like `Q_PUBLIC_SEARCH`, but ranks public profiles by how well they match the
# answers an unauthenticated user has given so far
Q_PUBLIC_SEARCH_WITH_ANSWERS = """
WITH searcher AS (
    SELECT %(searcher_personality)s::vector(47) AS personality
)
SELECT
    prospect.id AS prospect_person_id,

    prospect.uuid AS prospect_uuid,

    prospect.url_slug,

    prospect.name,

    prospect.verification_level_id > 1 AS verified,

    (
        SELECT
            uuid
        FROM
            photo
        WHERE
            person_id = prospect.id
        ORDER BY
            position
        LIMIT 1
    ) AS profile_photo_uuid,

    (
        SELECT
            blurhash
        FROM
            photo
        WHERE
            person_id = prospect.id
        ORDER BY
            position
        LIMIT 1
    ) AS profile_photo_blurhash,

    CASE
        WHEN prospect.show_my_age
        THEN EXTRACT(YEAR FROM AGE(prospect.date_of_birth))
        ELSE NULL
    END AS age,

    CLAMP(
        0,
        99,
        100 * (1 - (prospect.personality <#> searcher.personality)) / 2
    )::SMALLINT AS match_percentage,

    FALSE AS person_messaged_prospect,

    FALSE AS prospect_messaged_person,

    NULL AS verification_required_to_view
FROM
    person AS prospect,
    searcher
WHERE
    prospect.public_profile
AND
    prospect.activated
AND
    prospect.shadow_banned_at IS NULL
AND ( -- Exclude users who should be verified but aren't
        prospect.verification_level_id > 1
    OR
        NOT prospect.verification_required
)
AND
    prospect.last_online_time > now() - interval '7 days'
ORDER BY
    match_percentage DESC,
    prospect.id
LIMIT
    %(n)s
OFFSET
    %(o)s
"""

Q_QUIZ_SEARCH = f"""
WITH searcher AS (
    SELECT
        personality,
        count_answers
    FROM
        person
    WHERE
        person.id = %(searcher_person_id)s
), do_promote_verified AS (
    SELECT
        count(*) >= 250 AS x
    FROM
        search_cache,
        searcher
    WHERE
        searcher_person_id = %(searcher_person_id)s
    AND
        profile_photo_uuid IS NOT NULL
    AND
        verified
    AND
        (SELECT count_answers > 0 FROM searcher)
), page AS (
    SELECT
        prospect_person_id,
        prospect_uuid,
        (
            SELECT url_slug FROM person WHERE id = prospect_person_id
        ) AS url_slug,
        profile_photo_uuid,
        (
            SELECT blurhash FROM photo WHERE profile_photo_uuid = photo.uuid
        ) AS profile_photo_blurhash,
        name,
        age,
        CLAMP(
            0,
            99,
            100 * (1 - (personality <#> (SELECT personality FROM searcher))) / 2
        )::SMALLINT AS match_percentage,
        (
            SELECT
                verification_level_id
            FROM
                person
            WHERE
                id = %(searcher_person_id)s
        ) AS searcher_verification_level_id,
        (
            SELECT
                privacy_verification_level_id
            FROM
                person
            WHERE
                id = prospect_person_id
        ) AS privacy_verification_level_id
    FROM
        search_cache
    WHERE
        searcher_person_id = %(searcher_person_id)s
    ORDER BY
        -- If this is changed, other subqueries will need changing too
        CASE
            WHEN (SELECT x FROM do_promote_verified)
            THEN
                profile_photo_uuid IS NOT NULL AND verified
            ELSE
                profile_photo_uuid IS NOT NULL
        END DESC,

        match_percentage DESC
    LIMIT
        1
)
SELECT
    public_page.profile_photo_blurhash,
    public_page.name,
    public_page.age,
    public_page.match_percentage,
    public_page.verification_required_to_view,

    private_page.prospect_person_id,
    private_page.prospect_uuid,
    private_page.url_slug,
    private_page.profile_photo_uuid
FROM
    (
        SELECT
            *,

            CASE
                WHEN
                    searcher_verification_level_id >=
                    privacy_verification_level_id
                THEN NULL
                WHEN
                    privacy_verification_level_id = 2
                THEN 'basics'
                WHEN
                    privacy_verification_level_id = 3
                THEN 'photos'
            END AS verification_required_to_view
        FROM
            page
    ) AS public_page
LEFT JOIN
    (
        SELECT
            *
        FROM
            page
        WHERE
            searcher_verification_level_id >= privacy_verification_level_id
    ) AS private_page
ON
    private_page.prospect_person_id = public_page.prospect_person_id
"""

Q_FEED = f"""
WITH searcher AS (
    SELECT
        id as searcher_id,
        gender_id,
        date_of_birth,
        personality,
        verification_level_id
    FROM
        person
    WHERE
        person.id = %(searcher_person_id)s
), recent_person AS (
    (
        SELECT
            *
        FROM
            person
        WHERE
            last_online_time < %(before)s
        ORDER BY
            last_online_time DESC
        LIMIT
            5000
    )

    UNION DISTINCT

    (
        SELECT
            *
        FROM
            person
        WHERE
            last_event_time < %(before)s
        ORDER BY
            last_event_time DESC
        LIMIT
            5000
    )
), person_data AS (
    SELECT
        prospect.id,
        prospect.uuid AS person_uuid,
        prospect.url_slug,
        prospect.name,
        prospect.gender_id,
        photo_data.blurhash AS photo_blurhash,
        photo_data.uuid AS photo_uuid,
        prospect.verification_level_id > 1 AS is_verified,
        mapped_last_online_time,
        mapped_last_event_name,
        mapped_last_event_data,
        CLAMP(
            0,
            99,
            100 * (
                1 - (prospect.personality <#> searcher.personality)
            ) / 2
        )::SMALLINT AS match_percentage,
        flair,
        has_gold,
        sign_up_time,
        -- Ads have been removed; this is kept as a constant so existing native
        -- clients (which validate this field) keep working without the DB
        -- spending time computing it.
        FALSE AS advertiser_friendly,
        count_answers,
        about,
        (
            SELECT EXTRACT(YEAR FROM AGE(prospect.date_of_birth))
            WHERE prospect.show_my_age
        ) AS age,
        gender.name AS gender,
        (
            SELECT prospect.location_short_friendly
            WHERE prospect.show_my_location
        ) AS location
    FROM
        recent_person AS prospect
    JOIN
        gender
    ON
        gender.id = prospect.gender_id
    LEFT JOIN LATERAL (
        SELECT
            photo.uuid,
            photo.blurhash,
            photo.nsfw_score
        FROM
            photo
        WHERE
            photo.person_id = prospect.id
        ORDER BY
            photo.position
        LIMIT 1
    ) AS photo_data
    ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            photo.uuid,
            photo.blurhash,
            photo.nsfw_score,
            photo.extra_exts
        FROM
            photo
        WHERE
            photo.person_id = prospect.id
        ORDER BY
            '{{}}'::TEXT[] = extra_exts,
            photo.uuid = photo_data.uuid,
            random()
        LIMIT 1
    ) AS added_photo_data
    ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            prospect.last_online_time
            > now() - interval '{ONLINE_RECENTLY_SECONDS} seconds'
            AS was_recently_online
    )
    ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            CASE

            WHEN was_recently_online AND last_event_name = 'added-photo'
            THEN 'recently-online-with-photo'

            WHEN was_recently_online AND last_event_name = 'added-voice-bio'
            THEN 'recently-online-with-voice-bio'

            WHEN was_recently_online AND last_event_name = 'updated-bio'
            THEN 'recently-online-with-bio'

            WHEN was_recently_online AND added_photo_data.uuid IS NOT NULL
            THEN 'recently-online-with-photo'

            WHEN last_event_name = 'recently-online-with-photo'
            THEN 'added-photo'

            WHEN last_event_name = 'recently-online-with-voice-bio'
            THEN 'added-voice-bio'

            WHEN last_event_name = 'recently-online-with-bio'
            THEN 'updated-bio'

            ELSE last_event_name

            END::person_event AS mapped_last_event_name
    ) AS mapped_last_event_name
    ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            CASE
                WHEN
                    was_recently_online AND mapped_last_event_name <> 'joined'
                THEN
                    prospect.last_online_time
                ELSE
                    prospect.last_event_time
            END AS mapped_last_online_time
    ) AS mapped_last_online_time
    ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            CASE

            WHEN was_recently_online AND last_event_name = 'added-photo'
            THEN last_event_data

            WHEN was_recently_online AND last_event_name = 'added-voice-bio'
            THEN last_event_data

            WHEN was_recently_online AND last_event_name = 'updated-bio'
            THEN last_event_data

            WHEN was_recently_online AND added_photo_data.uuid IS NOT NULL
            THEN jsonb_build_object(
                'added_photo_uuid', added_photo_data.uuid,
                'added_photo_blurhash', added_photo_data.blurhash,
                'added_photo_extra_exts', added_photo_data.extra_exts
            )

            ELSE last_event_data

            END::JSONB AS mapped_last_event_data
    ) AS mapped_last_event_data
    ON TRUE
    CROSS JOIN
        searcher
    WHERE
        mapped_last_online_time < %(before)s
    AND
        last_event_time > now() - interval '1 month'
    AND
        activated
    AND
        shadow_banned_at IS NULL
    AND
        -- The searcher meets the prospects privacy_verification_level_id
        -- requirement
        prospect.privacy_verification_level_id <=
            searcher.verification_level_id
    AND
        -- The prospect wants to be shown to strangers or isn't a stranger
        (
            prospect.id IN (
                SELECT
                    subject_person_id
                FROM
                    messaged
                WHERE
                    object_person_id = %(searcher_person_id)s
            )
        OR
            NOT prospect.hide_me_from_strangers
        )
    AND
        -- The prospect did not skip the searcher
        prospect.id NOT IN (
            SELECT
                subject_person_id
            FROM
                skipped
            WHERE
                object_person_id = %(searcher_person_id)s
        )
    AND
        -- The searcher did not skip the prospect, or the searcher wishes to
        -- view skipped prospects
        (
            prospect.id NOT IN (
                SELECT
                    object_person_id
                FROM
                    skipped
                WHERE
                    subject_person_id = %(searcher_person_id)s
            )
        OR
            1 IN (
                SELECT
                    skipped_id
                FROM
                    search_preference_skipped
                WHERE
                    person_id = %(searcher_person_id)s
            )
        )
    AND
        -- The searcher did not message the prospect, or the searcher wishes to
        -- view messaged prospects
        (
            prospect.id NOT IN (
                SELECT
                    object_person_id
                FROM
                    messaged
                WHERE
                    subject_person_id = %(searcher_person_id)s
            )
        OR
            1 IN (
                SELECT
                    messaged_id
                FROM
                    search_preference_messaged
                WHERE
                    person_id = %(searcher_person_id)s
            )
        )
    -- Decrease users' odds of appearing in the feed if they're already getting
    -- lots of messages
    AND random() < (
        SELECT
            1.0 / (1.0 + count(*)::real) ^ 1.5
        FROM
            messaged
        WHERE
            object_person_id = prospect.id
        AND
            created_at > now() - interval '1 day'
    )
    -- Decrease users' odds of appearing in the feed as the age gap between them
    -- and the searcher grows
    AND random() < age_gap_acceptability_odds(
        EXTRACT(YEAR FROM AGE(searcher.date_of_birth)),
        EXTRACT(YEAR FROM AGE(prospect.date_of_birth))
    )
    -- The searcher meets the prospect's gender preference
    AND EXISTS (
        SELECT
            1
        FROM
            search_preference_gender
        WHERE
            search_preference_gender.person_id = prospect.id
        AND
            search_preference_gender.gender_id = searcher.gender_id
    )
    -- Exclude photos that might be NSFW
    AND NOT EXISTS (
        SELECT
            1
        FROM
            photo
        WHERE
            uuid = mapped_last_event_data->>'added_photo_uuid'
        AND
            photo.nsfw_score > 0.2
    )
    -- Exclude users who were reported two or more times in the past day
    AND (
        SELECT
            count(*)
        FROM
            skipped
        WHERE
            object_person_id = prospect.id
        AND
            created_at > now() - interval '2 days'
        AND
            reported
    ) < 2
    -- Exclude users who aren't verified but are required to be
    AND (
            prospect.verification_level_id > 1
        OR
            NOT prospect.verification_required
    )
    -- Exclude users who don't seem human. A user seems human if:
    --   * They're verified; or
    --   * Their account is more than a month old; or
    --   * They've customized their account's color scheme
    --   * They've got an audio bio
    --   * They've got an otherwise well-completed profile
    --   * They've got Gold
    AND (
            prospect.verification_level_id > 1

        OR
            prospect.sign_up_time < now() - interval '1 month'

        OR
            lower(prospect.title_color) <> '#000000'
        OR
            lower(prospect.body_color) <> '#000000'
        OR
            lower(prospect.background_color) <> '#ffffff'

        OR EXISTS (
            SELECT 1 FROM audio WHERE person_id = prospect.id
        )

        OR
            prospect.count_answers >= 25
        AND
            length(prospect.about) > 0
        AND EXISTS (
            SELECT 1 FROM person_club WHERE person_id = prospect.id
        )

        OR
            prospect.has_gold
    )
    -- Exclude the searcher from their own feed results
    AND
        searcher_id <> prospect.id
    ORDER BY
        mapped_last_online_time DESC
    LIMIT
        {FEED_RESULTS_PER_PAGE * FEED_SELECTIVITY}
), filtered_by_club AS (
    SELECT
        person_uuid,
        url_slug,
        name,
        photo_uuid,
        photo_blurhash,
        is_verified,
        match_percentage,
        mapped_last_event_name AS type,
        iso8601_utc(mapped_last_online_time) AS time,
        mapped_last_online_time AS last_event_time,
        mapped_last_event_data,
        ({Q_COMPUTED_FLAIR}) AS flair,
        age,
        gender,
        location,
        advertiser_friendly
    FROM
        person_data,
        searcher
    ORDER BY
        EXISTS (
            SELECT
                1
            FROM
                search_preference_gender AS preference
            WHERE
                preference.person_id = searcher_id
            AND
                preference.gender_id = person_data.gender_id
        ) DESC,
        match_percentage DESC,
        mapped_last_online_time DESC
    LIMIT
        (SELECT round(count(*)::real / {FEED_SELECTIVITY}) FROM person_data)
)
SELECT
    jsonb_build_object(
        'person_uuid', person_uuid,
        'url_slug', url_slug,
        'name', name,
        'photo_uuid', photo_uuid,
        'photo_blurhash', photo_blurhash,
        'is_verified', is_verified,
        'time', time,
        'type', type,
        'match_percentage', match_percentage,
        'flair', flair,
        'age', age,
        'gender', gender,
        'location', location,
        'advertiser_friendly', advertiser_friendly
    ) || mapped_last_event_data AS j
FROM
    filtered_by_club
ORDER BY
    last_event_time DESC
"""

Q_FEED_V2 = f"""
WITH searcher AS (
    SELECT
        id as searcher_id,
        uuid AS searcher_uuid,
        url_slug AS searcher_url_slug,
        gender_id,
        personality,
        verification_level_id
    FROM
        person
    WHERE
        person.id = %(searcher_person_id)s
), searcher_photo AS (
    -- The searcher's first photo, for rendering their own avatar in
    -- 'joined-club' and 'answered-question' facepiles. Zero rows if they
    -- have no photos.
    SELECT
        photo.uuid,
        photo.blurhash
    FROM
        searcher
    JOIN
        photo
    ON
        photo.person_id = searcher.searcher_id
    ORDER BY
        photo.position
    LIMIT 1
), recent_person AS (
    -- Unlike v1, the feed is ordered by when people's current online session
    -- started (came_online_time) rather than by event time, so a single scan
    -- of the came-online index bounds the candidate pool. Ordering by
    -- last_online_time would let people game the feed by staying online 24/7;
    -- came_online_time only advances when they go from zero connected clients
    -- to one.
    SELECT
        *
    FROM
        person
    WHERE
        came_online_time < %(before)s
    AND
        came_online_time < now() - interval '1 minute'
    AND
        last_online_time < now() - interval '1 minute'
    ORDER BY
        came_online_time DESC
    LIMIT
        5000
), person_data AS (
    SELECT
        prospect.id,
        prospect.uuid AS person_uuid,
        prospect.url_slug,
        prospect.name,
        photo_data.blurhash AS photo_blurhash,
        photo_data.uuid AS photo_uuid,
        prospect.verification_level_id > 1 AS is_verified,
        prospect.last_online_time,
        prospect.came_online_time,
        mapped_last_event_time,
        mapped_last_event_name,
        mapped_last_event_data,
        CLAMP(
            0,
            99,
            100 * (
                1 - (prospect.personality <#> searcher.personality)
            ) / 2
        )::SMALLINT AS match_percentage,
        flair,
        has_gold,
        sign_up_time,
        -- Ads have been removed; this is kept as a constant so existing native
        -- clients (which validate this field) keep working without the DB
        -- spending time computing it.
        FALSE AS advertiser_friendly,
        count_answers,
        about,
        (
            SELECT EXTRACT(YEAR FROM AGE(prospect.date_of_birth))
            WHERE prospect.show_my_age
        ) AS age,
        gender.name AS gender,
        (
            SELECT prospect.location_short_friendly
            WHERE prospect.show_my_location
        ) AS location
    FROM
        recent_person AS prospect
    JOIN
        gender
    ON
        gender.id = prospect.gender_id
    LEFT JOIN LATERAL (
        SELECT
            photo.uuid,
            photo.blurhash,
            photo.nsfw_score
        FROM
            photo
        WHERE
            photo.person_id = prospect.id
        ORDER BY
            photo.position
        LIMIT 1
    ) AS photo_data
    ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            -- Events which are less than a week old are shown as themselves,
            -- at their event time. Older events are replaced by a
            -- 'recently-online-with-*' event shown at the prospect's
            -- last-online time, so the feed feels fresh.
            -- 'was-recently-online' is a legacy event with no content of its
            -- own, so it's never shown as itself.
            prospect.last_event_time > now() - interval '1 week'
            AND prospect.last_event_name <> 'was-recently-online'
            AS event_is_fresh,

            -- Legacy rows can store 'recently-online-with-*' names directly;
            -- normalize them to the underlying content event.
            CASE prospect.last_event_name

            WHEN 'recently-online-with-photo'
            THEN 'added-photo'

            WHEN 'recently-online-with-voice-bio'
            THEN 'added-voice-bio'

            WHEN 'recently-online-with-bio'
            THEN 'updated-bio'

            ELSE prospect.last_event_name

            END::person_event AS content_event_name
    ) AS normalized_event
    ON TRUE
    LEFT JOIN LATERAL (
        -- A random photo for synthesizing a 'recently-online-with-photo'
        -- event when the prospect's last event is stale and has no content of
        -- its own
        SELECT
            photo.uuid,
            photo.blurhash,
            photo.extra_exts
        FROM
            photo
        WHERE
            photo.person_id = prospect.id
        AND
            NOT event_is_fresh
        AND
            content_event_name NOT IN (
                'added-photo',
                'added-voice-bio',
                'updated-bio'
            )
        ORDER BY
            '{{}}'::TEXT[] = extra_exts,
            photo.uuid = photo_data.uuid,
            random()
        LIMIT 1
    ) AS added_photo_data
    ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            CASE

            WHEN event_is_fresh
            THEN content_event_name

            WHEN content_event_name = 'added-photo'
            THEN 'recently-online-with-photo'

            WHEN content_event_name = 'added-voice-bio'
            THEN 'recently-online-with-voice-bio'

            WHEN content_event_name = 'updated-bio'
            THEN 'recently-online-with-bio'

            WHEN added_photo_data.uuid IS NOT NULL
            THEN 'recently-online-with-photo'

            -- The event is stale and there's nothing to synthesize a
            -- 'recently-online-with-*' event from; the prospect is excluded

            END::person_event AS mapped_last_event_name
    ) AS mapped_last_event_name
    ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            CASE
                WHEN event_is_fresh
                THEN prospect.last_event_time
                ELSE prospect.last_online_time
            END AS mapped_last_event_time
    ) AS mapped_last_event_time
    ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            CASE

            WHEN
                event_is_fresh
            OR
                content_event_name IN (
                    'added-photo',
                    'added-voice-bio',
                    'updated-bio'
                )
            THEN prospect.last_event_data

            WHEN added_photo_data.uuid IS NOT NULL
            THEN jsonb_build_object(
                'added_photo_uuid', added_photo_data.uuid,
                'added_photo_blurhash', added_photo_data.blurhash,
                'added_photo_extra_exts', added_photo_data.extra_exts
            )

            ELSE prospect.last_event_data

            END::JSONB AS mapped_last_event_data
    ) AS mapped_last_event_data
    ON TRUE
    CROSS JOIN
        searcher
    WHERE
        mapped_last_event_name IS NOT NULL
    AND
        activated
    AND
        shadow_banned_at IS NULL
    AND
        -- The searcher meets the prospects privacy_verification_level_id
        -- requirement
        prospect.privacy_verification_level_id <=
            searcher.verification_level_id
    AND
        -- The prospect wants to be shown to strangers or isn't a stranger
        (
            prospect.id IN (
                SELECT
                    subject_person_id
                FROM
                    messaged
                WHERE
                    object_person_id = %(searcher_person_id)s
            )
        OR
            NOT prospect.hide_me_from_strangers
        )
    AND
        -- The prospect did not skip the searcher
        prospect.id NOT IN (
            SELECT
                subject_person_id
            FROM
                skipped
            WHERE
                object_person_id = %(searcher_person_id)s
        )
    AND
        -- The searcher did not skip the prospect, or the searcher wishes to
        -- view skipped prospects
        (
            prospect.id NOT IN (
                SELECT
                    object_person_id
                FROM
                    skipped
                WHERE
                    subject_person_id = %(searcher_person_id)s
            )
        OR
            1 IN (
                SELECT
                    skipped_id
                FROM
                    search_preference_skipped
                WHERE
                    person_id = %(searcher_person_id)s
            )
        )
    AND
        -- The searcher did not message the prospect, or the searcher wishes to
        -- view messaged prospects
        (
            prospect.id NOT IN (
                SELECT
                    object_person_id
                FROM
                    messaged
                WHERE
                    subject_person_id = %(searcher_person_id)s
            )
        OR
            1 IN (
                SELECT
                    messaged_id
                FROM
                    search_preference_messaged
                WHERE
                    person_id = %(searcher_person_id)s
            )
        )
    -- Decrease users' odds of appearing in the feed if they're already getting
    -- lots of messages
    AND random() < (
        SELECT
            1.0 / (1.0 + count(*)::real) ^ 0.5
        FROM
            messaged
        WHERE
            object_person_id = prospect.id
        AND
            created_at > now() - interval '1 day'
    )
    -- The prospect's gender is one the searcher prefers
    AND EXISTS (
        SELECT
            1
        FROM
            search_preference_gender AS preference
        WHERE
            preference.person_id = searcher.searcher_id
        AND
            preference.gender_id = prospect.gender_id
    )
    -- The searcher's gender is one the prospect prefers
    AND EXISTS (
        SELECT
            1
        FROM
            search_preference_gender AS preference
        WHERE
            preference.person_id = prospect.id
        AND
            preference.gender_id = searcher.gender_id
    )
    -- The prospect meets the searcher's age preference
    AND EXISTS (
        SELECT
            1
        FROM
            search_preference_age AS preference
        WHERE
            preference.person_id = searcher.searcher_id
        AND
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
    -- Exclude photos that might be NSFW
    AND NOT EXISTS (
        SELECT
            1
        FROM
            photo
        WHERE
            uuid = mapped_last_event_data->>'added_photo_uuid'
        AND
            photo.nsfw_score > 0.2
    )
    -- Exclude events advertising clubs that were banned after being joined.
    -- Only 'joined-club' events have a 'joined_club_name' key, so the check
    -- on `last_event_name` is redundant, but it short-circuits the lookup for
    -- other events and stops the planner from flattening the NOT EXISTS into
    -- an anti-join, which it has been observed to plan as a repeated
    -- sequential scan of banned_club.
    AND (
        prospect.last_event_name <> 'joined-club'
    OR NOT EXISTS (
        SELECT
            1
        FROM
            banned_club
        WHERE
            banned_club.name =
                LOWER(prospect.last_event_data->>'joined_club_name')
    ))
    -- Exclude users who were reported two or more times in the past day
    AND (
        SELECT
            count(*)
        FROM
            skipped
        WHERE
            object_person_id = prospect.id
        AND
            created_at > now() - interval '2 days'
        AND
            reported
    ) < 2
    -- Exclude users who aren't verified but are required to be
    AND (
            prospect.verification_level_id > 1
        OR
            NOT prospect.verification_required
    )
    -- Exclude users who don't seem human. A user seems human if:
    --   * They're verified; or
    --   * Their account is more than a week old; or
    --   * They've customized their account's color scheme
    --   * They've got an audio bio
    --   * They've got an otherwise well-completed profile
    --   * They've got Gold
    AND (
            prospect.verification_level_id > 1

        OR
            prospect.sign_up_time < now() - interval '1 week'

        OR
            lower(prospect.title_color) <> '#000000'
        OR
            lower(prospect.body_color) <> '#000000'
        OR
            lower(prospect.background_color) <> '#ffffff'

        OR EXISTS (
            SELECT 1 FROM audio WHERE person_id = prospect.id
        )

        OR
            prospect.count_answers >= 25
        AND
            length(prospect.about) > 0
        AND EXISTS (
            SELECT 1 FROM person_club WHERE person_id = prospect.id
        )

        OR
            prospect.has_gold
    )
    -- Exclude the searcher from their own feed results
    AND
        searcher_id <> prospect.id
    ORDER BY
        prospect.came_online_time DESC
    LIMIT
        {FEED_RESULTS_PER_PAGE}
), feed_page AS (
    SELECT
        id,
        person_uuid,
        url_slug,
        name,
        photo_uuid,
        photo_blurhash,
        is_verified,
        match_percentage,
        mapped_last_event_name AS type,
        iso8601_utc(mapped_last_event_time) AS time,
        -- When the person was last online, for display
        iso8601_utc(last_online_time) AS online_time,
        -- The feed is ordered and paginated by when people's online session
        -- started, so clients need this as their `before` cursor for the
        -- next page.
        iso8601_utc(came_online_time) AS came_online_time_iso,
        came_online_time,
        mapped_last_event_data,
        ({Q_COMPUTED_FLAIR}) AS flair,
        age,
        gender,
        location,
        advertiser_friendly
    FROM
        person_data
)
SELECT
    jsonb_build_object(
        'person_uuid', person_uuid,
        'url_slug', url_slug,
        'name', name,
        'photo_uuid', photo_uuid,
        'photo_blurhash', photo_blurhash,
        'is_verified', is_verified,
        'time', time,
        'online_time', online_time,
        'came_online_time', came_online_time_iso,
        'type', type,
        'match_percentage', match_percentage,
        'flair', flair,
        'age', age,
        'gender', gender,
        'location', location,
        'advertiser_friendly', advertiser_friendly
    )
    || mapped_last_event_data
    || COALESCE(joined_club_data.j, '{{}}'::jsonb)
    || COALESCE(answered_question_data.j, '{{}}'::jsonb)
    AS j
FROM
    feed_page
CROSS JOIN
    searcher
LEFT JOIN LATERAL (
    SELECT
        jsonb_build_object(
            'club_count_members', club.count_members,
            'club_sample_members', COALESCE(facepile.j, '[]'::jsonb),
            'club_viewer', jsonb_build_object(
                'person_uuid', searcher.searcher_uuid,
                'url_slug', searcher.searcher_url_slug,
                'photo_uuid', searcher_photo.uuid,
                'photo_blurhash', searcher_photo.blurhash
            )
        ) AS j
    FROM
        club
    LEFT JOIN
        searcher_photo
    ON
        TRUE
    LEFT JOIN LATERAL (
        {_club_facepile()}
    ) AS facepile
    ON TRUE
    WHERE
        feed_page.type = 'joined-club'
    AND
        -- A range condition rather than `=` so the planner probes the club's
        -- btree primary key. Plain equality also matches the trigram gist
        -- index on `name`, which the planner has been observed to pick
        -- despite it being ~100x slower to probe.
        club.name >= (feed_page.mapped_last_event_data
            ->> 'joined_club_name')
    AND
        club.name <= (feed_page.mapped_last_event_data
            ->> 'joined_club_name')
) AS joined_club_data
ON TRUE
LEFT JOIN LATERAL (
    SELECT
        jsonb_build_object(
            'question_text', question.question,
            'question_topic', question.topic,
            -- Like the quiz screen's counts, these include private answers,
            -- which is also what makes them cheap: counting only public
            -- answers would mean aggregating over the question's answers on
            -- every read
            'question_count_yes', question.count_yes,
            'question_count_no', question.count_no,
            'question_yes_members', COALESCE(yes_facepile.j, '[]'::jsonb),
            'question_no_members', COALESCE(no_facepile.j, '[]'::jsonb),
            'question_subject_answer', subject_answer.answer,
            'question_viewer', jsonb_build_object(
                'person_uuid', searcher.searcher_uuid,
                'url_slug', searcher.searcher_url_slug,
                'photo_uuid', searcher_photo.uuid,
                'photo_blurhash', searcher_photo.blurhash,
                'answer', viewer_answer.answer,
                'public_', viewer_answer.public_
            )
        ) AS j
    FROM
        question
    LEFT JOIN
        searcher_photo
    ON
        TRUE
    LEFT JOIN LATERAL (
        -- The searcher's own answer, sent whether or not it's public (it's
        -- their own answer). Were a private answer sent as unanswered,
        -- answering from the feed would silently re-answer it publicly.
        SELECT
            answer.answer,
            answer.public_
        FROM
            answer
        WHERE
            answer.person_id = searcher.searcher_id
        AND
            answer.question_id = question.id
    ) AS viewer_answer
    ON TRUE
    LEFT JOIN LATERAL (
        SELECT
            answer.answer
        FROM
            answer
        WHERE
            answer.person_id = feed_page.id
        AND
            answer.question_id = question.id
        AND
            {ANSWER_VISIBLE_TO_OTHERS}
    ) AS subject_answer
    ON TRUE
    LEFT JOIN LATERAL (
        {_question_facepile(True)}
    ) AS yes_facepile
    ON TRUE
    LEFT JOIN LATERAL (
        {_question_facepile(False)}
    ) AS no_facepile
    ON TRUE
    WHERE
        feed_page.type = 'answered-question'
    AND
        question.id = (feed_page.mapped_last_event_data
            ->> 'answered_question_id')::SMALLINT
) AS answered_question_data
ON TRUE
ORDER BY
    came_online_time DESC
"""
