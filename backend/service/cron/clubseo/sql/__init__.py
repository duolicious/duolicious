from serviceshared.constants import (
    MIN_CLUB_PAGE_MEMBERS,
    MIN_CLUB_CELL_SIZE,
    MIN_CLUB_ANSWERS_PER_QUESTION,
    MIN_ANSWER_DIVERGENCE_PCT,
    MAX_CLUB_TOP_ANSWERS,
    MAX_CLUB_SAMPLE_MEMBERS,
    MAX_CLUBS_PER_PERSON_FOR_OVERLAP,
)

# These live here (not in person/sql) so the cron process can run
# them without importing person, which builds a boto3 client and
# pulls in Flask/PIL/etc. at import time.
#
# Personality maths: `person.personality` is a 47-dim pgvector (46 traits
# + 1 padding dim), unit-normalised and then scaled by an answer-count
# weight, so each component lies in [-1, 1]. The per-trait mean across
# members therefore also lies in [-1, 1], with +/-1 meaning every member's
# vector points entirely along that dim. Multiplying by 100 turns that
# into an interpretable -100..100 lean; the clamp is defence in depth.
#
# Lookup tables store id = 1 as "Unanswered" for every attribute except
# `gender` (where id = 1 is the real value "Man"), so the demographic CTEs
# exclude id = 1 everywhere except gender.

Q_CLUB_STATS_BATCH = f"""
WITH target AS MATERIALIZED (
    SELECT
        c.name,
        c.count_members,
        (d.club_name IS NOT NULL) AS is_dirty
    FROM
        club c
    LEFT JOIN
        club_stats cs ON cs.club_name = c.name
    LEFT JOIN
        club_stats_dirty d ON d.club_name = c.name
    WHERE
        c.count_members >= {MIN_CLUB_PAGE_MEMBERS}
    AND (
        d.club_name IS NOT NULL
        OR cs.club_name IS NULL
        OR cs.computed_at < NOW() - MAKE_INTERVAL(days => %(max_age_days)s)
    )
    ORDER BY
        (cs.club_name IS NULL) DESC,
        (d.club_name IS NOT NULL) DESC,
        cs.computed_at NULLS FIRST,
        c.count_members DESC
    LIMIT %(batch_size)s
), sampled AS MATERIALIZED (
    SELECT t.name AS club_name, s.person_id
    FROM target t
    CROSS JOIN LATERAL (
        SELECT pc.person_id
        FROM person_club pc
        WHERE pc.club_name = t.name
          AND pc.activated
        ORDER BY pc.person_id DESC
        LIMIT {MAX_CLUB_SAMPLE_MEMBERS}
    ) s
), members AS MATERIALIZED (
    SELECT
        s.club_name,
        p.gender_id,
        p.orientation_id,
        p.ethnicity_id,
        p.religion_id,
        p.drinking_id,
        p.smoking_id,
        p.drugs_id,
        p.exercise_id,
        p.has_kids_id,
        p.wants_kids_id,
        p.relationship_status_id,
        p.date_of_birth,
        p.personality,
        p.count_answers
    FROM
        sampled s
    JOIN
        person p ON p.id = s.person_id
-- Each per-dimension aggregate is MATERIALIZED so the planner doesn't
-- inline it into the payload's correlated subqueries and re-scan `members`
-- per target club (~10x slowdown on a batch of 200).
), gender_j AS MATERIALIZED (
    SELECT club_name, COALESCE(json_agg(json_build_object('label', name, 'count', cnt) ORDER BY cnt DESC), '[]'::json) AS j
    FROM (SELECT m.club_name, g.name, COUNT(*)::int AS cnt FROM members m JOIN gender g ON g.id = m.gender_id GROUP BY m.club_name, g.name HAVING COUNT(*) >= {MIN_CLUB_CELL_SIZE}) x
    GROUP BY club_name
), orientation_j AS MATERIALIZED (
    SELECT club_name, COALESCE(json_agg(json_build_object('label', name, 'count', cnt) ORDER BY cnt DESC), '[]'::json) AS j
    FROM (SELECT m.club_name, o.name, COUNT(*)::int AS cnt FROM members m JOIN orientation o ON o.id = m.orientation_id WHERE m.orientation_id <> 1 GROUP BY m.club_name, o.name HAVING COUNT(*) >= {MIN_CLUB_CELL_SIZE}) x
    GROUP BY club_name
), ethnicity_j AS MATERIALIZED (
    SELECT club_name, COALESCE(json_agg(json_build_object('label', name, 'count', cnt) ORDER BY cnt DESC), '[]'::json) AS j
    FROM (SELECT m.club_name, e.name, COUNT(*)::int AS cnt FROM members m JOIN ethnicity e ON e.id = m.ethnicity_id WHERE m.ethnicity_id <> 1 GROUP BY m.club_name, e.name HAVING COUNT(*) >= {MIN_CLUB_CELL_SIZE}) x
    GROUP BY club_name
), religion_j AS MATERIALIZED (
    SELECT club_name, COALESCE(json_agg(json_build_object('label', name, 'count', cnt) ORDER BY cnt DESC), '[]'::json) AS j
    FROM (SELECT m.club_name, r.name, COUNT(*)::int AS cnt FROM members m JOIN religion r ON r.id = m.religion_id WHERE m.religion_id <> 1 GROUP BY m.club_name, r.name HAVING COUNT(*) >= {MIN_CLUB_CELL_SIZE}) x
    GROUP BY club_name
), relationship_status_j AS MATERIALIZED (
    SELECT club_name, COALESCE(json_agg(json_build_object('label', name, 'count', cnt) ORDER BY cnt DESC), '[]'::json) AS j
    FROM (SELECT m.club_name, r.name, COUNT(*)::int AS cnt FROM members m JOIN relationship_status r ON r.id = m.relationship_status_id WHERE m.relationship_status_id <> 1 GROUP BY m.club_name, r.name HAVING COUNT(*) >= {MIN_CLUB_CELL_SIZE}) x
    GROUP BY club_name
), drinking_j AS MATERIALIZED (
    SELECT club_name, COALESCE(json_agg(json_build_object('label', name, 'count', cnt) ORDER BY cnt DESC), '[]'::json) AS j
    FROM (SELECT m.club_name, f.name, COUNT(*)::int AS cnt FROM members m JOIN frequency f ON f.id = m.drinking_id WHERE m.drinking_id <> 1 GROUP BY m.club_name, f.name HAVING COUNT(*) >= {MIN_CLUB_CELL_SIZE}) x
    GROUP BY club_name
), smoking_j AS MATERIALIZED (
    SELECT club_name, COALESCE(json_agg(json_build_object('label', name, 'count', cnt) ORDER BY cnt DESC), '[]'::json) AS j
    FROM (SELECT m.club_name, y.name, COUNT(*)::int AS cnt FROM members m JOIN yes_no_optional y ON y.id = m.smoking_id WHERE m.smoking_id <> 1 GROUP BY m.club_name, y.name HAVING COUNT(*) >= {MIN_CLUB_CELL_SIZE}) x
    GROUP BY club_name
), drugs_j AS MATERIALIZED (
    SELECT club_name, COALESCE(json_agg(json_build_object('label', name, 'count', cnt) ORDER BY cnt DESC), '[]'::json) AS j
    FROM (SELECT m.club_name, y.name, COUNT(*)::int AS cnt FROM members m JOIN yes_no_optional y ON y.id = m.drugs_id WHERE m.drugs_id <> 1 GROUP BY m.club_name, y.name HAVING COUNT(*) >= {MIN_CLUB_CELL_SIZE}) x
    GROUP BY club_name
), exercise_j AS MATERIALIZED (
    SELECT club_name, COALESCE(json_agg(json_build_object('label', name, 'count', cnt) ORDER BY cnt DESC), '[]'::json) AS j
    FROM (SELECT m.club_name, f.name, COUNT(*)::int AS cnt FROM members m JOIN frequency f ON f.id = m.exercise_id WHERE m.exercise_id <> 1 GROUP BY m.club_name, f.name HAVING COUNT(*) >= {MIN_CLUB_CELL_SIZE}) x
    GROUP BY club_name
), has_kids_j AS MATERIALIZED (
    SELECT club_name, COALESCE(json_agg(json_build_object('label', name, 'count', cnt) ORDER BY cnt DESC), '[]'::json) AS j
    FROM (SELECT m.club_name, y.name, COUNT(*)::int AS cnt FROM members m JOIN yes_no_optional y ON y.id = m.has_kids_id WHERE m.has_kids_id <> 1 GROUP BY m.club_name, y.name HAVING COUNT(*) >= {MIN_CLUB_CELL_SIZE}) x
    GROUP BY club_name
), wants_kids_j AS MATERIALIZED (
    SELECT club_name, COALESCE(json_agg(json_build_object('label', name, 'count', cnt) ORDER BY cnt DESC), '[]'::json) AS j
    FROM (SELECT m.club_name, y.name, COUNT(*)::int AS cnt FROM members m JOIN yes_no_maybe y ON y.id = m.wants_kids_id WHERE m.wants_kids_id <> 1 GROUP BY m.club_name, y.name HAVING COUNT(*) >= {MIN_CLUB_CELL_SIZE}) x
    GROUP BY club_name
), age_buckets_j AS MATERIALIZED (
    SELECT club_name, COALESCE(json_agg(json_build_object('label', bucket, 'count', cnt) ORDER BY bucket), '[]'::json) AS j
    FROM (
        SELECT
            club_name,
            CASE
                WHEN age < 25 THEN '18-24'
                WHEN age < 35 THEN '25-34'
                WHEN age < 45 THEN '35-44'
                WHEN age < 55 THEN '45-54'
                ELSE '55+'
            END AS bucket,
            COUNT(*)::int AS cnt
        FROM (
            SELECT club_name, DATE_PART('year', AGE(date_of_birth))::int AS age FROM members
        ) ages
        GROUP BY club_name, bucket
        HAVING COUNT(*) >= {MIN_CLUB_CELL_SIZE}
    ) b
    GROUP BY club_name
), median_age_j AS MATERIALIZED (
    SELECT
        club_name,
        ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY DATE_PART('year', AGE(date_of_birth))))::int AS median_age
    FROM members
    GROUP BY club_name
), personality_vec AS MATERIALIZED (
    -- pgvector's AVG aggregates element-wise; members with few answers have
    -- shorter (answer-count-weighted) vectors and so contribute less.
    SELECT club_name, (AVG(personality))::real[] AS arr
    FROM members
    WHERE count_answers > 0
    GROUP BY club_name
), personality_j AS MATERIALIZED (
    SELECT
        pv.club_name,
        COALESCE(
            json_agg(
                json_build_object(
                    'trait',     t.name,
                    'min_label', t.min_label,
                    'max_label', t.max_label,
                    'score',     GREATEST(-100, LEAST(100, ROUND((pv.arr[t.id] * 100)::numeric)::int))
                )
                ORDER BY t.id
            ),
            '[]'::json
        ) AS j
    FROM personality_vec pv
    CROSS JOIN trait t
    WHERE t.id <= 46 AND pv.arr IS NOT NULL
    GROUP BY pv.club_name
), payload AS (
    SELECT
        t.name,
        json_build_object(
            'name',         t.name,
            'member_count', t.count_members,
            'median_age',   maj.median_age,
            'demographics', json_build_object(
                'gender',              COALESCE(gj.j,  '[]'::json),
                'orientation',         COALESCE(oj.j,  '[]'::json),
                'ethnicity',           COALESCE(ej.j,  '[]'::json),
                'religion',            COALESCE(rj.j,  '[]'::json),
                'relationship_status', COALESCE(rsj.j, '[]'::json),
                'age_buckets',         COALESCE(abj.j, '[]'::json)
            ),
            'lifestyle', json_build_object(
                'drinking',   COALESCE(dj.j,  '[]'::json),
                'smoking',    COALESCE(sj.j,  '[]'::json),
                'drugs',      COALESCE(drj.j, '[]'::json),
                'exercise',   COALESCE(exj.j, '[]'::json),
                'has_kids',   COALESCE(hkj.j, '[]'::json),
                'wants_kids', COALESCE(wkj.j, '[]'::json)
            ),
            'personality',   COALESCE(pj.j,  '[]'::json)
        ) AS j
    FROM target t
    LEFT JOIN gender_j              gj  ON gj.club_name  = t.name
    LEFT JOIN orientation_j         oj  ON oj.club_name  = t.name
    LEFT JOIN ethnicity_j           ej  ON ej.club_name  = t.name
    LEFT JOIN religion_j            rj  ON rj.club_name  = t.name
    LEFT JOIN relationship_status_j rsj ON rsj.club_name = t.name
    LEFT JOIN age_buckets_j         abj ON abj.club_name = t.name
    LEFT JOIN drinking_j            dj  ON dj.club_name  = t.name
    LEFT JOIN smoking_j             sj  ON sj.club_name  = t.name
    LEFT JOIN drugs_j               drj ON drj.club_name = t.name
    LEFT JOIN exercise_j            exj ON exj.club_name = t.name
    LEFT JOIN has_kids_j            hkj ON hkj.club_name = t.name
    LEFT JOIN wants_kids_j          wkj ON wkj.club_name = t.name
    LEFT JOIN median_age_j          maj ON maj.club_name = t.name
    LEFT JOIN personality_j         pj  ON pj.club_name  = t.name
), upserted AS (
    INSERT INTO club_stats (club_name, stats_json, computed_at)
    SELECT name, j, NOW() FROM payload
    ON CONFLICT (club_name) DO UPDATE SET
        stats_json  = EXCLUDED.stats_json,
        computed_at = NOW()
    RETURNING club_name
), cleaned AS (
    DELETE FROM club_stats_dirty
    WHERE club_name IN (SELECT name FROM target WHERE is_dirty)
    RETURNING club_name
)
SELECT
    (SELECT COUNT(*) FROM upserted) AS upserted_count,
    (SELECT COUNT(*) FROM cleaned)  AS cleaned_count
"""

# A club with no qualifying answers still gets a row (with answers_json =
# []) so its computed_at advances and it rotates to the back of the queue.
Q_CLUB_TOP_ANSWERS_BATCH = f"""
WITH target AS MATERIALIZED (
    SELECT
        c.name,
        c.count_members
    FROM
        club c
    LEFT JOIN
        club_top_answers cta ON cta.club_name = c.name
    WHERE
        c.count_members >= {MIN_CLUB_PAGE_MEMBERS}
    ORDER BY
        cta.club_name IS NULL DESC,
        cta.computed_at NULLS FIRST,
        c.count_members DESC
    LIMIT %(batch_size)s
), sampled AS MATERIALIZED (
    SELECT t.name AS club_name, s.person_id
    FROM target t
    CROSS JOIN LATERAL (
        SELECT pc.person_id
        FROM person_club pc
        WHERE pc.club_name = t.name
          AND pc.activated
        ORDER BY pc.person_id DESC
        LIMIT {MAX_CLUB_SAMPLE_MEMBERS}
    ) s
), club_answer AS (
    -- Drive from the sampled members into answer via its PK
    -- (person_id, question_id); starting from question/answer would touch
    -- the whole 40M-row answer table.
    SELECT
        s.club_name,
        a.question_id,
        COUNT(*) FILTER (WHERE a.answer IS NOT NULL)::int AS total_cnt,
        COUNT(*) FILTER (WHERE a.answer IS TRUE)::int     AS yes_cnt
    FROM
        sampled s
    JOIN
        answer a ON a.person_id = s.person_id
    GROUP BY
        s.club_name, a.question_id
    HAVING
        COUNT(*) FILTER (WHERE a.answer IS NOT NULL) >= {MIN_CLUB_ANSWERS_PER_QUESTION}
), answer_ranked AS (
    SELECT
        ca.club_name,
        q.question,
        pct.club_yes_pct,
        pct.platform_yes_pct,
        ABS(pct.club_yes_pct - pct.platform_yes_pct) AS abs_delta,
        ROW_NUMBER() OVER (
            PARTITION BY ca.club_name
            ORDER BY ABS(pct.club_yes_pct - pct.platform_yes_pct) DESC
        ) AS rn
    FROM club_answer ca
    JOIN question q ON q.id = ca.question_id
    CROSS JOIN LATERAL (
        SELECT
            ca.yes_cnt::float8 / ca.total_cnt * 100 AS club_yes_pct,
            q.count_yes::float8 / NULLIF(q.count_yes + q.count_no, 0) * 100 AS platform_yes_pct
    ) pct
    WHERE pct.platform_yes_pct IS NOT NULL
      AND ABS(pct.club_yes_pct - pct.platform_yes_pct) >= {MIN_ANSWER_DIVERGENCE_PCT}
), top_answers_j AS (
    SELECT
        club_name,
        json_agg(
            json_build_object(
                'question',           question,
                'club_agree_pct',     ROUND(club_yes_pct::numeric)::int,
                'platform_agree_pct', ROUND(platform_yes_pct::numeric)::int
            )
            ORDER BY abs_delta DESC
        ) AS j
    FROM answer_ranked
    WHERE rn <= {MAX_CLUB_TOP_ANSWERS}
    GROUP BY club_name
), upserted AS (
    INSERT INTO club_top_answers (club_name, answers_json, computed_at)
    SELECT
        t.name,
        COALESCE((SELECT j FROM top_answers_j WHERE club_name = t.name), '[]'::json),
        NOW()
    FROM target t
    ON CONFLICT (club_name) DO UPDATE SET
        answers_json = EXCLUDED.answers_json,
        computed_at  = NOW()
    RETURNING club_name
)
SELECT COUNT(*) AS upserted_count FROM upserted
"""

# top_answers_json is joined in here (rather than included in the stats
# payload) so the LLM sees the freshest divergence facts even though the
# answer-divergence refresh runs on its own slower cadence.
Q_CLUB_SEO_NEXT_REFRESH = f"""
SELECT
    c.name,
    cs.stats_json,
    COALESCE(cta.answers_json, '[]'::jsonb) AS top_answers_json,
    seo.stats_hash AS old_stats_hash,
    EXTRACT(EPOCH FROM (NOW() - seo.generated_at)) / 86400.0 AS age_days
FROM
    club c
JOIN
    club_stats cs ON cs.club_name = c.name
LEFT JOIN
    club_top_answers cta ON cta.club_name = c.name
LEFT JOIN
    club_seo seo ON seo.club_name = c.name
WHERE
    c.count_members >= {MIN_CLUB_PAGE_MEMBERS}
ORDER BY
    seo.club_name IS NULL DESC,
    seo.generated_at NULLS FIRST,
    c.count_members DESC
LIMIT %(batch_size)s
"""

Q_CLUB_SEO_TOUCH = """
UPDATE
    club_seo
SET
    generated_at = NOW()
WHERE
    club_name = %(club_name)s
"""

Q_CLUB_SEO_UPSERT = """
INSERT INTO club_seo (club_name, description, stats_hash)
VALUES (%(club_name)s, %(description)s, %(stats_hash)s)
ON CONFLICT (club_name) DO UPDATE SET
    description  = EXCLUDED.description,
    stats_hash   = EXCLUDED.stats_hash,
    generated_at = NOW()
"""

# Advance generated_at without touching description/stats_hash, so a
# failed attempt rotates the club to the back of the queue instead of
# being re-selected every tick.
Q_CLUB_SEO_MARK_ATTEMPTED = """
INSERT INTO club_seo (club_name, description, stats_hash, generated_at)
VALUES (%(club_name)s, NULL, NULL, NOW())
ON CONFLICT (club_name) DO UPDATE SET
    generated_at = NOW()
"""

Q_CLUB_OVERLAP_DELETE = """
DELETE FROM club_overlap
"""

# Members of more than MAX_CLUBS_PER_PERSON_FOR_OVERLAP clubs are dropped:
# a person in k clubs contributes k*(k-1) pairs, so without the cap a
# handful of hyper-joiners dominate cost while adding only noise.
# Both directions (a->b and b->a) are written so the read side is a
# single PK range scan.
Q_CLUB_OVERLAP_REBUILD = f"""
WITH eligible_members AS MATERIALIZED (
    SELECT
        pc.person_id,
        pc.club_name,
        c.count_members
    FROM
        person_club pc
    JOIN
        club c ON c.name = pc.club_name AND c.count_members >= {MIN_CLUB_PAGE_MEMBERS}
    WHERE
        pc.activated
    AND
        pc.person_id IN (
            SELECT person_id
            FROM person_club
            WHERE activated
            GROUP BY person_id
            HAVING COUNT(*) <= {MAX_CLUBS_PER_PERSON_FOR_OVERLAP}
        )
)
INSERT INTO club_overlap (club_a, club_b, overlap, count_members_b)
SELECT
    a.club_name,
    b.club_name,
    COUNT(*)::int,
    -- All rows in a given (a, b) group share the same b.count_members;
    -- MAX is just a cheap "any-value" aggregate.
    MAX(b.count_members)
FROM
    eligible_members a
JOIN
    eligible_members b
ON
    b.person_id = a.person_id
AND
    b.club_name <> a.club_name
GROUP BY
    a.club_name, b.club_name
HAVING
    COUNT(*) >= {MIN_CLUB_CELL_SIZE}
"""
