import math
from datetime import date, datetime
from functools import cache
from pathlib import Path

import numpy as np
import numpy.typing as npt
import onnxruntime as ort
from pydantic import BaseModel
from tokenizers import Tokenizer

from serviceshared.inference import onnx_session

_DIR = Path(__file__).parent

MODEL = _DIR / 'model.onnx'

MAX_TOKENS = 96

CLIP_WIDTH = 768

Q_PEOPLE = f"""
SELECT
    person.id,
    person.date_of_birth,
    person.gender_id,
    person.orientation_id,
    person.count_intros_sent AS sent,
    person.count_intros_sent_with_reply AS sent_with_reply,
    person.count_intros_received AS received,
    person.count_intros_received_with_reply AS received_with_reply,
    photos.count,
    photos.verified_count,
    photos.nsfw_score,
    photos.clip_embedding
FROM
    person
CROSS JOIN LATERAL (
    SELECT
        count(*) AS count,
        count(*) FILTER (WHERE verified) AS verified_count,
        COALESCE(max(nsfw_score_v2), 'NaN') AS nsfw_score,
        COALESCE(
            avg(clip_embedding)::REAL[],
            array_fill('NaN'::REAL, ARRAY[{CLIP_WIDTH}])
        ) AS clip_embedding
    FROM
        photo
    WHERE
        person_id = person.id
) AS photos
WHERE
    person.id = ANY(%(person_ids)s::INT[])
"""


TOKENIZER = Tokenizer.from_file(
    str(_DIR.parent / 'antiabuse/antirude/chat/tokenizer.json'))
TOKENIZER.enable_truncation(max_length=MAX_TOKENS)

class Person(BaseModel):
    id: int
    date_of_birth: date
    gender_id: int
    orientation_id: int
    sent: int
    sent_with_reply: int
    received: int
    received_with_reply: int
    count: int
    verified_count: int
    nsfw_score: float
    clip_embedding: list[float]


def _ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else math.nan


def _numbers(person: Person, sent_at: datetime) -> list[float]:
    return [
        (sent_at.date() - person.date_of_birth).days / 365.25,
        person.sent,
        person.received,
        _ratio(person.sent_with_reply, person.sent),
        _ratio(person.received_with_reply, person.received),
        person.count,
        person.verified_count,
        person.nsfw_score,
    ]


def inputs(
    sender: Person,
    recipient: Person,
    sent_at: datetime,
) -> dict[str, npt.NDArray[np.float32] | npt.NDArray[np.int64]]:
    people = (sender, recipient)
    return dict(
        numbers=np.array(
            [x for p in people for x in _numbers(p, sent_at)], np.float32),
        categories=np.array(
            [i for p in people for i in (p.gender_id, p.orientation_id)],
            np.int64),
        photos=np.array([p.clip_embedding for p in people], np.float32),
    )


@cache
def _session() -> ort.InferenceSession:
    return onnx_session(str(MODEL))


def score(
    body: str,
    sender: Person,
    recipient: Person,
    sent_at: datetime,
) -> float:
    feed = {
        name: value[None]
        for name, value in inputs(sender, recipient, sent_at).items()}
    feed['input_ids'] = np.array([TOKENIZER.encode(body).ids])
    return float(_session().run(None, feed)[0][0])
