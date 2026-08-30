"""The "Match percentage" model: a person's answers are reduced to per-trait
`presence`/`absence` scores, which in turn produce their personality vector.
The stored vector has one extra constant dimension appended to the 46 trait
dimensions (giving 47) so that it is never the zero vector.

The scores are running sums, so an answer change is folded in and its old
value folded out rather than re-reading every answer; the old value arrives
with the change (`Watch.capture`).
"""
import numpy
import numpy.typing as npt
from collections.abc import Iterable, Mapping, Sequence
from typing import Literal

from pgvector import Vector

from serviceshared.tx import Tx
from serviceshared.matching.model import Capture, CapturedChange, Watch

TRAIT_COUNT = 46

_CONSTANT_DIMENSION = 1e-5


ScoreValues = Sequence[int]
IntArray = npt.NDArray[numpy.int64]
FloatArray = npt.NDArray[numpy.float64]

# The per-trait score vectors a question contributes, used to (re)compute
# personality vectors on the application server.
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

Q_SET_PERSONALITY = """
UPDATE person
SET
    personality    = %(personality)s,
    presence_score = %(presence_score)s,
    absence_score  = %(absence_score)s,
    count_answers  = %(count_answers)s
WHERE
    id = %(person_id)s
"""


def given_score_vectors(
    question: Mapping[str, ScoreValues],
    answer: bool | None,
) -> tuple[ScoreValues | None, ScoreValues | None]:
    """The (presence, absence) score vectors contributed by answering
    `question` (a row with the `*_given_yes`/`*_given_no` arrays) with `answer`.
    A skipped answer (None) contributes nothing."""
    if answer is True:
        return question['presence_given_yes'], question['absence_given_yes']
    if answer is False:
        return question['presence_given_no'], question['absence_given_no']
    return None, None


def fold(
    presence: IntArray,
    absence: IntArray,
    count: int,
    given_presence: ScoreValues | None,
    given_absence: ScoreValues | None,
    sign: Literal[1, -1],
) -> tuple[IntArray, IntArray, int]:
    """Add (sign=+1) or remove (sign=-1) one answer's contribution from the
    accumulated scores. Returns the updated (presence, absence, count)."""
    if given_presence is None or given_absence is None:
        return presence, absence, count

    given_presence_array = numpy.array(given_presence, dtype=numpy.int64)
    given_absence_array = numpy.array(given_absence, dtype=numpy.int64)
    excess = numpy.minimum(given_presence_array, given_absence_array)

    return (
        presence + sign * (given_presence_array - excess),
        absence + sign * (given_absence_array - excess),
        count + sign,
    )


def accumulate(
    answered_questions: Iterable[tuple[Mapping[str, ScoreValues], bool | None]],
) -> tuple[IntArray, IntArray, int]:
    """Accumulate scores over a batch of (question, answer) pairs, starting from
    zero. Returns (presence, absence, count) as numpy arrays / int."""
    presence = numpy.zeros(TRAIT_COUNT, dtype=numpy.int64)
    absence = numpy.zeros(TRAIT_COUNT, dtype=numpy.int64)
    count = 0

    for question, answer in answered_questions:
        given_presence, given_absence = given_score_vectors(question, answer)
        presence, absence, count = fold(
            presence, absence, count, given_presence, given_absence, +1)

    return presence, absence, count


def personality_vector(
    presence_score: Sequence[int] | IntArray,
    absence_score: Sequence[int] | IntArray,
    count_answers: int,
) -> FloatArray:
    """The 47-dim personality vector for the given accumulated scores."""
    presence = numpy.array(presence_score, dtype=numpy.int64)
    absence = numpy.array(absence_score, dtype=numpy.int64)

    denominator = presence + absence
    trait_percentages = numpy.divide(
        presence,
        denominator,
        out=numpy.full(TRAIT_COUNT, 0.5, dtype=numpy.float64),
        where=denominator != 0,
    )

    ll = lambda x: numpy.log(numpy.log(x + 1) + 1)
    weight = numpy.clip(ll(count_answers) / ll(250), 0, 1)

    personality = numpy.asarray(2 * trait_percentages - 1, dtype=numpy.float64)
    personality = numpy.concatenate([personality, [_CONSTANT_DIMENSION]])
    personality = personality / numpy.linalg.norm(personality)
    personality = personality * weight

    return personality


class _MatchPercentageModel:
    name = 'match_percentage'
    watched: Mapping[str, Watch] = {
        'answer': Watch(
            update_columns=frozenset({'answer'}),
            inserts=True,
            deletes=True,
            capture=Capture(key_column='question_id', value_column='answer'),
        ),
    }

    async def person_changed(
        self,
        tx: Tx,
        person_id: int,
        changes: Sequence[CapturedChange],
    ) -> None:
        if not changes:
            return

        question_tx = await tx.execute(Q_QUESTION_SCORE_VECTORS, dict(
            question_ids=[change.key for change in changes]))
        questions = {
            question['id']: question
            for question in await question_tx.fetchall()}

        scores = await tx.require_one(
            Q_GET_PERSONALITY_SCORES, dict(person_id=person_id))
        presence = scores['presence_score']
        absence = scores['absence_score']
        count = scores['count_answers']

        for change in changes:
            question = questions.get(change.key)
            if question is None:
                continue
            given = given_score_vectors(question, change.new)
            presence, absence, count = fold(
                presence, absence, count, given[0], given[1], +1)
            given = given_score_vectors(question, change.old)
            presence, absence, count = fold(
                presence, absence, count, given[0], given[1], -1)

        await tx.execute(Q_SET_PERSONALITY, dict(
            person_id=person_id,
            personality=Vector(personality_vector(presence, absence, count)),
            presence_score=numpy.asarray(presence).tolist(),
            absence_score=numpy.asarray(absence).tolist(),
            count_answers=int(count),
        ))


MODEL = _MatchPercentageModel()
