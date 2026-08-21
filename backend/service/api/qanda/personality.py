import numpy
import numpy.typing as npt
from collections.abc import Iterable, Mapping, Sequence
from typing import Literal

# A person's answers are reduced to per-trait `presence`/`absence` scores, which
# in turn produce their personality vector. The stored vector has one extra
# constant dimension appended to the 46 trait dimensions (giving 47) so that it
# is never the zero vector.
TRAIT_COUNT = 46

_CONSTANT_DIMENSION = 1e-5


ScoreValues = Sequence[int]
IntArray = npt.NDArray[numpy.int64]
FloatArray = npt.NDArray[numpy.float64]


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


def to_pgvector(personality: Iterable[float]) -> str:
    """Format a personality vector as a pgvector text literal for `::vector`."""
    return '[' + ','.join(repr(float(x)) for x in personality) + ']'
