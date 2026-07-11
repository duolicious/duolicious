from dataclasses import dataclass
import numpy
import psycopg
from answerspush import publish_answer_update
from batcher import Batcher
from constants import ANSWERED_QUESTION_EVENT_REFRESH_SECONDS
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
    answer,
    public_
FROM
    answer
WHERE
    person_id = %(person_id)s AND
    question_id = %(question_id)s
"""

# A person's quiz answer is only ever visible to *other* people while it's
# public and actually answered. Every query that serves someone else's answer
# -- chat question-cards on live delivery (`questioncard`) and MAM
# (`Q_SELECT_MESSAGE`), and the feed's subject answer (`Q_FEED_V2`) --
# interpolates this one predicate, so the privacy rule can't silently drift
# between those paths. Assumes the answer table is aliased `answer`.
ANSWER_VISIBLE_TO_OTHERS = "(answer.public_ AND answer.answer IS NOT NULL)"

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

Q_SET_ANSWERED_QUESTION_EVENT = """
UPDATE person
SET
    last_event_time = now(),
    last_event_name = 'answered-question',
    last_event_data = jsonb_build_object(
        'answered_question_id', %(question_id)s
    )
WHERE
    id = %(person_id)s
AND (
    last_event_name <> 'answered-question'
OR
    last_event_time <= now() - make_interval(secs => %(refresh_seconds)s)
)
"""

# Stop advertising the answer in the feed if it's the person's latest event
Q_REVERT_ANSWERED_QUESTION_EVENT = """
UPDATE person
SET
    last_event_time = sign_up_time,
    last_event_name = 'joined',
    last_event_data = '{}'::jsonb
WHERE
    id = %(person_id)s
AND
    last_event_name = 'answered-question'
AND
    last_event_data->>'answered_question_id' = %(question_id)s::TEXT
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


# `visible_answer` is what other users may now see: the answer when it's
# public, else None. Publishing to the answers channel only when
# `visible_answer_changed` means private edits can never leak -- an edit that
# starts and ends hidden produces no event at all.
@dataclass(frozen=True)
class AnswerWriteResult:
    visible_answer: bool | None
    visible_answer_changed: bool


@dataclass(frozen=True)
class YesNoCountJob:
    question_id: int
    add_yes: int
    add_no: int


async def _process_yes_no_count_batch(jobs: list[YesNoCountJob]) -> None:
    totals: dict[int, tuple[int, int]] = {}
    for job in jobs:
        add_yes, add_no = totals.get(job.question_id, (0, 0))
        totals[job.question_id] = (add_yes + job.add_yes, add_no + job.add_no)

    # Sorted so that concurrent batches (one per API instance) lock question
    # rows in the same order and can't deadlock
    params_seq = [
        dict(question_id=question_id, add_yes=add_yes, add_no=add_no)
        for question_id, (add_yes, add_no) in sorted(totals.items())
        if add_yes or add_no
    ]

    if not params_seq:
        return

    async with api_tx('read committed') as tx:
        await tx.executemany(Q_ADD_YES_NO_COUNT, params_seq)


def _enqueue_yes_no_count(question_id: int, answer: bool | None) -> None:
    _yes_no_count_batcher.enqueue(YesNoCountJob(
        question_id=question_id,
        add_yes=1 if answer is True else 0,
        add_no=1 if answer is False else 0,
    ))

async def _set_answer(
    tx: Tx,
    person_id: int,
    question_id: int,
    answer: bool | None,
    public: bool | None,
    delete: bool,
    write_event: bool = True,
) -> AnswerWriteResult | None:
    question_tx = await tx.execute(
        Q_QUESTION_SCORE_VECTORS,
        dict(question_ids=[question_id]),
    )
    question: Row | None = await question_tx.fetchone()

    if question is None:
        return None

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

    is_visible = not delete and answer is not None and bool(public)

    # The feed event is written in this same transaction, so it commits (or
    # rolls back) atomically with the answer and personality columns and
    # nothing else contends for the person row. `write_event` is False for
    # pre-signup answers, which must never advertise in the feed.
    if write_event and is_visible:
        await tx.execute(Q_SET_ANSWERED_QUESTION_EVENT, dict(
            person_id=person_id,
            question_id=question_id,
            refresh_seconds=ANSWERED_QUESTION_EVENT_REFRESH_SECONDS,
        ))
    elif write_event:
        await tx.execute(Q_REVERT_ANSWERED_QUESTION_EVENT, dict(
            person_id=person_id,
            question_id=question_id,
        ))

    old_visible = (
        old['answer']
        if old is not None and old['answer'] is not None and old['public_']
        else None)
    new_visible = answer if is_visible else None

    # The answers-channel publish is left to the caller so it happens only
    # after this transaction commits: a rolled-back answer must not reach the
    # channel.
    return AnswerWriteResult(
        visible_answer=new_visible,
        visible_answer_changed=new_visible != old_visible,
    )

# `_set_answer` is the only writer of a person's row per answer now that the
# feed event is written inside its transaction, so serialization failures are
# no longer routine. The one remaining conflict is a person answering two
# questions truly concurrently -- both read-modify-write their personality
# columns, and repeatable-read must abort one to prevent a lost update. That's
# rare, and retrying re-runs the read-modify-write on a fresh snapshot, which
# is safe: nothing is published until the transaction commits.
_SET_ANSWER_TRIES = 3
_SET_ANSWER_RETRYABLE = (
    psycopg.errors.SerializationFailure,
    psycopg.errors.DeadlockDetected,
)

async def _set_answer_with_retry(
    person_id: int,
    question_id: int,
    answer: bool | None,
    public: bool | None,
    delete: bool,
) -> AnswerWriteResult | None:
    for attempt in range(_SET_ANSWER_TRIES):
        try:
            async with api_tx() as tx:
                return await _set_answer(
                    tx, person_id, question_id, answer, public, delete)
        except _SET_ANSWER_RETRYABLE:
            if attempt == _SET_ANSWER_TRIES - 1:
                raise

    return None

async def post_answer(req: t.PostAnswer, s: t.SessionInfo) -> object | None:
    if s.person_id is None:
        return '', 500

    result = await _set_answer_with_retry(
        s.person_id,
        req.question_id,
        req.answer,
        req.public,
        delete=False,
    )

    _enqueue_yes_no_count(req.question_id, req.answer)

    if result and result.visible_answer_changed and s.person_uuid:
        await publish_answer_update(
            username=s.person_uuid,
            question_id=req.question_id,
            answer=result.visible_answer,
        )

    return None

async def delete_answer(req: t.DeleteAnswer, s: t.SessionInfo) -> object | None:
    if s.person_id is None:
        return '', 500

    result = await _set_answer_with_retry(
        s.person_id,
        req.question_id,
        None,
        None,
        delete=True,
    )

    if result and result.visible_answer_changed and s.person_uuid:
        await publish_answer_update(
            username=s.person_uuid,
            question_id=req.question_id,
            answer=result.visible_answer,
        )

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
        _enqueue_yes_no_count(answer['question_id'], answer['answer'])

        # `write_event=False` and the dropped result: answers stashed before
        # signup shouldn't advertise in the feed or publish updates.
        await _set_answer(
            tx,
            person_id,
            answer['question_id'],
            answer['answer'],
            answer.get('public', True),
            delete=False,
            write_event=False,
        )

    await tx.execute(
        Q_CLEAR_SESSION_ANSWERS,
        dict(session_token_hash=session_token_hash),
    )


# Every answer write bumps a globally hot row -- the question's yes/no counts
# -- and quiz players write in bursts, so many users hammer the same question
# row at once. Batching moves those writes off the request path and coalesces
# each batch into one write per question. (The answerer's person row, by
# contrast, is written inside `_set_answer`'s own transaction: it's per-person,
# not globally hot, so it needs no batching and stays free of cross-transaction
# contention.)
_yes_no_count_batcher = Batcher[YesNoCountJob](
    process_fn=_process_yes_no_count_batch,
    flush_interval=1.0,
    min_batch_size=1,
    max_batch_size=1000,
    retry=False,
)
