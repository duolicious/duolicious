import numpy
from database import Row, Tx, api_tx
import duotypes as t
from qanda import personality
from qanda.question import Q_QUESTION_SCORE_VECTORS

Q_GET_PERSONALITY_SCORES = """
SELECT
    presence_score,
    absence_score,
    count_answers
FROM
    person
WHERE
    id = %(person_id)s
"""

Q_GET_ANSWER = """
SELECT
    answer
FROM
    answer
WHERE
    person_id = %(person_id)s AND
    question_id = %(question_id)s
"""

Q_UPSERT_ANSWER = """
INSERT INTO answer (
    person_id,
    question_id,
    answer,
    public_
)
VALUES (
    %(person_id)s,
    %(question_id)s,
    %(answer)s,
    %(public)s
)
ON CONFLICT (person_id, question_id) DO UPDATE SET
    answer  = EXCLUDED.answer,
    public_ = EXCLUDED.public_
"""

Q_DELETE_ANSWER = """
DELETE FROM answer
WHERE
    person_id = %(person_id)s AND
    question_id = %(question_id)s
"""

Q_SET_PERSONALITY = """
UPDATE person
SET
    personality    = %(personality)s::vector,
    presence_score = %(presence_score)s,
    absence_score  = %(absence_score)s,
    count_answers  = %(count_answers)s
WHERE
    id = %(person_id)s
"""

Q_ADD_YES_NO_COUNT = """
UPDATE question
SET
    count_yes = count_yes + %(add_yes)s,
    count_no  = count_no  + %(add_no)s
WHERE
    id = %(question_id)s
"""

# Answers given before sign-up are stashed on the session row created by
# `/request-otp` (see `duo_session.answers`), then flushed into `answer` once
# the session resolves to a person.
Q_GET_SESSION_ANSWERS = """
SELECT
    answers
FROM
    duo_session
WHERE
    session_token_hash = %(session_token_hash)s
"""

Q_CLEAR_SESSION_ANSWERS = """
UPDATE duo_session
SET answers = NULL
WHERE session_token_hash = %(session_token_hash)s
"""

async def _set_answer(
    tx: Tx,
    person_id: int,
    question_id: int,
    answer: bool | None,
    public: bool | None,
    delete: bool,
) -> None:
    question_tx = await tx.execute(
        Q_QUESTION_SCORE_VECTORS,
        dict(question_ids=[question_id]),
    )
    question: Row | None = await question_tx.fetchone()

    if question is None:
        return

    scores = await tx.require_one(
        Q_GET_PERSONALITY_SCORES,
        dict(person_id=person_id),
    )

    old_tx = await tx.execute(
        Q_GET_ANSWER,
        dict(person_id=person_id, question_id=question_id),
    )
    old: Row | None = await old_tx.fetchone()

    presence = scores['presence_score']
    absence = scores['absence_score']
    count = scores['count_answers']

    if not delete:
        given = personality.given_score_vectors(question, answer)
        presence, absence, count = personality.fold(
            presence, absence, count, given[0], given[1], +1)

    if old is not None:
        given = personality.given_score_vectors(question, old['answer'])
        presence, absence, count = personality.fold(
            presence, absence, count, given[0], given[1], -1)

    vector = personality.personality_vector(presence, absence, count)

    if delete:
        await tx.execute(Q_DELETE_ANSWER, dict(
            person_id=person_id,
            question_id=question_id,
        ))
    else:
        await tx.execute(Q_UPSERT_ANSWER, dict(
            person_id=person_id,
            question_id=question_id,
            answer=answer,
            public=public,
        ))

    await tx.execute(Q_SET_PERSONALITY, dict(
        person_id=person_id,
        personality=personality.to_pgvector(vector),
        presence_score=numpy.asarray(presence).tolist(),
        absence_score=numpy.asarray(absence).tolist(),
        count_answers=int(count),
    ))

async def post_answer(req: t.PostAnswer, s: t.SessionInfo) -> object | None:
    if s.person_id is None:
        return '', 500

    params_add_yes_no_count = dict(
        question_id=req.question_id,
        add_yes=1 if req.answer is True else 0,
        add_no=1 if req.answer is False else 0,
    )

    async with api_tx('READ COMMITTED') as tx:
        await tx.execute(Q_ADD_YES_NO_COUNT, params_add_yes_no_count)

    async with api_tx() as tx:
        await _set_answer(
            tx, s.person_id, req.question_id, req.answer, req.public, delete=False)
    return None

async def delete_answer(req: t.DeleteAnswer, s: t.SessionInfo) -> object | None:
    if s.person_id is None:
        return '', 500

    async with api_tx() as tx:
        await _set_answer(
            tx, s.person_id, req.question_id, None, None, delete=True)
    return None


async def _flush_session_answers(
    tx: Tx,
    session_token_hash: str,
    person_id: int,
) -> None:
    """
    Async counterpart to `_flush_session_answers` for native FastAPI routes.
    """
    row_tx = await tx.execute(
        Q_GET_SESSION_ANSWERS,
        dict(session_token_hash=session_token_hash),
    )
    row: Row | None = await row_tx.fetchone()

    answers = (row and row['answers']) or []

    for answer in answers:
        await tx.execute(Q_ADD_YES_NO_COUNT, dict(
            question_id=answer['question_id'],
            add_yes=1 if answer['answer'] is True else 0,
            add_no=1 if answer['answer'] is False else 0,
        ))

        await _set_answer(
            tx,
            person_id,
            answer['question_id'],
            answer['answer'],
            answer.get('public', True),
            delete=False,
        )

    await tx.execute(
        Q_CLEAR_SESSION_ANSWERS,
        dict(session_token_hash=session_token_hash),
    )
