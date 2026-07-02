import os
from database import api_tx
import duotypes as t
from questions.archetypeise_questions import load_questions
from typing import List, Optional
import json

_categorised_question_json_file = os.path.join(
        os.path.dirname(__file__), '..',
        'questions', 'questions-categorised.txt')

_archetypeised_question_json_file = os.path.join(
        os.path.dirname(__file__), '..',
        'questions', 'questions-archetypeised.txt')

_questions_text_file = os.path.join(
        os.path.dirname(__file__), '..',
        'questions', 'questions.txt')

Q_GET_NEXT_QUESTIONS = """
SELECT
    question.id,
    question.question,
    question.topic,
    question.count_yes,
    question.count_no
FROM
    question
LEFT JOIN
    answer
ON
    answer.question_id = question.id
AND
    answer.person_id = %(person_id)s
WHERE
    answer.question_id IS NULL
ORDER BY
    CASE
        WHEN question.id <= 10
        THEN LPAD(question.id::text, 5, '0')
        ELSE MD5 (question.id::text || ' ' || %(person_id)s::text)
    END
LIMIT
    %(n)s
OFFSET
    %(o)s;
"""

# The per-trait score vectors a question contributes, used to (re)compute
# personality vectors on the application server (see the `personality` module).
Q_QUESTION_SCORE_VECTORS = """
SELECT
    id,
    presence_given_yes,
    presence_given_no,
    absence_given_yes,
    absence_given_no
FROM
    question
WHERE
    id = ANY(%(question_ids)s)
"""

Q_GET_PUBLIC_NEXT_QUESTIONS = """
SELECT
    question.id,
    question.question,
    question.topic,
    question.count_yes,
    question.count_no
FROM
    question
ORDER BY
    question.id
LIMIT
    %(n)s
OFFSET
    %(o)s;
"""

Q_GET_SEARCH_FILTER_QUESTIONS = """
SELECT
    id AS question_id,
    question,
    topic,
    answer,
    COALESCE(accept_unanswered, TRUE) AS accept_unanswered
FROM
    question
LEFT JOIN
    search_preference_answer
ON
    question.id = question_id
AND
    person_id = %(person_id)s
ORDER BY question <-> %(q)s
LIMIT %(n)s
OFFSET %(o)s
"""

async def init_db() -> None:
    with open(_categorised_question_json_file) as f:
        categorised_questions = json.load(f)

    with open(_questions_text_file) as f:
        question_to_index = {l.strip(): i for i, l in enumerate(f.readlines())}

    categorised_questions["categorised"].sort(
        key=lambda q: question_to_index[q["question"]])

    async with api_tx() as tx:
        if (await tx.require_one('SELECT COUNT(*) FROM question'))['count'] == 0:
            await tx.executemany(
                """
                INSERT INTO question (
                    question,
                    topic,
                    presence_given_yes,
                    presence_given_no,
                    absence_given_yes,
                    absence_given_no
                ) VALUES (
                    %(question)s,
                    %(topic)s,
                    ARRAY[]::INT[],
                    ARRAY[]::INT[],
                    ARRAY[]::INT[],
                    ARRAY[]::INT[]
                )
                """,
                [
                    dict(
                        question=question["question"],
                        topic=question["category"].capitalize(),
                    )
                    for question in categorised_questions["categorised"]
                ]
            )

    archetypeised_questions = load_questions(_archetypeised_question_json_file)

    async with api_tx() as tx:
        if (await tx.require_one(
            """
            SELECT COUNT(*)
            FROM question
            WHERE presence_given_yes = ARRAY[]::INT[]
            """
        ))['count'] > 0:
            await tx.execute(
                """
                CREATE TEMPORARY TABLE question_trait_pair (
                    question_id SMALLSERIAL NOT NULL,
                    trait_id SMALLSERIAL NOT NULL,
                    presence_given_yes SMALLINT NOT NULL,
                    presence_given_no SMALLINT NOT NULL,
                    absence_given_yes SMALLINT NOT NULL,
                    absence_given_no SMALLINT NOT NULL,
                    CHECK (presence_given_yes >= 0),
                    CHECK (presence_given_no >= 0),
                    CHECK (absence_given_yes >= 0),
                    CHECK (absence_given_no >= 0),
                    PRIMARY KEY (question_id, trait_id)
                )
                """
            )
            await tx.executemany(
                """
                INSERT INTO question_trait_pair (
                    question_id,
                    trait_id,
                    presence_given_yes,
                    presence_given_no,
                    absence_given_yes,
                    absence_given_no
                )
                VALUES (
                    (SELECT id FROM question WHERE question = %(question)s),
                    (SELECT id FROM trait WHERE name = %(trait)s),
                    %(presence_given_yes)s,
                    %(presence_given_no)s,
                    %(absence_given_yes)s,
                    %(absence_given_no)s
                );
                """,
                [
                    dict(
                        question=question.question,
                        trait=question.trait,
                        presence_given_yes=round(
                            1000 * question.presence_given_yes()),
                        presence_given_no=round(
                            1000 * question.presence_given_no()),
                        absence_given_yes=round(
                            1000 * question.absence_given_yes()),
                        absence_given_no=round(
                            1000 * question.absence_given_no()),
                    )
                    for question in archetypeised_questions.archetypeised
                ]
            )
            await tx.execute(
                """
                UPDATE question
                SET
                    presence_given_yes = vector.pgy,
                    presence_given_no  = vector.pgn,
                    absence_given_yes  = vector.agy,
                    absence_given_no   = vector.agn
                FROM (
                    SELECT
                        question_id,
                        ARRAY_AGG(presence_given_yes ORDER BY trait_id) AS pgy,
                        ARRAY_AGG(presence_given_no  ORDER BY trait_id) AS pgn,
                        ARRAY_AGG(absence_given_yes  ORDER BY trait_id) AS agy,
                        ARRAY_AGG(absence_given_no   ORDER BY trait_id) AS agn
                    FROM question_trait_pair
                    GROUP BY question_id
                ) AS vector
                WHERE vector.question_id = question.id
                """
            )

async def get_next_questions(s: t.SessionInfo, n: str, o: str) -> object:
    params = dict(
        person_id=s.person_id,
        n=int(n),
        o=int(o),
    )

    async with api_tx('READ COMMITTED') as tx:
        row_tx = await tx.execute(Q_GET_NEXT_QUESTIONS, params)
        return await row_tx.fetchall()

async def get_public_next_questions(n: str, o: str) -> object:
    params = dict(
        n=int(n),
        o=int(o),
    )

    async with api_tx('READ COMMITTED') as tx:
        row_tx = await tx.execute(Q_GET_PUBLIC_NEXT_QUESTIONS, params)
        return await row_tx.fetchall()

async def get_search_filter_questions(
    s: t.SessionInfo,
    q: str,
    n: str,
    o: str,
) -> object:
    params = dict(
        person_id=s.person_id,
        q=q,
        n=int(n),
        o=int(o),
    )

    async with api_tx('READ COMMITTED') as tx:
        row_tx = await tx.execute(Q_GET_SEARCH_FILTER_QUESTIONS, params)
        return await row_tx.fetchall()
