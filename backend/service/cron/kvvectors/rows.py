"""Turn database rows into the dense blocks the encoders consume."""
import numpy as np

from service.cron.kvvectors.blocks import Blocks, F64Array, FloatArray, IntArray
from service.cron.kvvectors.spec import Spec

Row = dict[str, object]
Triple = tuple[int, int, bool]

# training filled missing enum values with 1, the "Unanswered" member
UNANSWERED = 1
DEFAULT_LAST_ONLINE_ID = 4


def _floats(people: list[Row], name: str) -> F64Array:
    out = np.empty(len(people), np.float64)
    for i, p in enumerate(people):
        v = p[name]
        out[i] = np.nan if v is None else float(v)  # type: ignore[arg-type]
    return out


def _ints(people: list[Row], name: str, default: int) -> IntArray:
    out = np.empty(len(people), np.int64)
    for i, p in enumerate(people):
        v = p[name]
        out[i] = default if v is None else int(v)  # type: ignore[call-overload]
    return out


def _sparse_pm1(spec: Spec, index: dict[int, int], triples: list[Triple],
                n: int) -> FloatArray:
    out = np.zeros((n, len(spec.qids)), np.float32)
    for person_id, question_id, answer in triples:
        row = index.get(person_id)
        col = spec.qid_column.get(question_id)
        if row is None or col is None:
            continue
        out[row, col] = 1.0 if answer else -1.0
    return out


def _multi_hot(people: list[Row], field: str, size: int) -> FloatArray:
    out = np.zeros((len(people), size), np.float32)
    for i, p in enumerate(people):
        values = p[field]
        if values is None:
            continue
        for v in values:  # type: ignore[attr-defined]
            if 0 <= int(v) < size:
                out[i, int(v)] = 1.0
    return out


def build(spec: Spec, people: list[Row], answers: list[Triple],
          pref_answers: list[Triple], clubs: list[tuple[int, str]]) -> Blocks:
    n = len(people)
    person_ids = np.array([int(p['id']) for p in people], np.int64)  # type: ignore[call-overload]
    index = {int(pid): i for i, pid in enumerate(person_ids)}

    club_block = np.zeros((n, len(spec.clubs)), np.float32)
    for person_id, name in clubs:
        row = index.get(person_id)
        col = spec.club_column.get(name)
        if row is not None and col is not None:
            club_block[row, col] = 1.0

    country = np.array(
        [spec.country_column.get(str(p['country'] or ''), 0) for p in people],
        np.int64)

    return Blocks(
        person_ids=person_ids,
        age=_floats(people, 'age'),
        height_cm=_floats(people, 'height_cm'),
        lat=_floats(people, 'lat'),
        lon=_floats(people, 'lon'),
        answers=_sparse_pm1(spec, index, answers, n),
        cats=[_ints(people, f, UNANSWERED) for f in spec.cat_fields],
        country=country,
        clubs=club_block,
        pref_answers=_sparse_pm1(spec, index, pref_answers, n),
        pref_multi=np.concatenate(
            [_multi_hot(people, f, int(size))
             for f, size in zip(spec.pref_multi_fields, spec.pref_multi_sizes)],
            axis=1),
        pref_min_age=_floats(people, 'min_age'),
        pref_max_age=_floats(people, 'max_age'),
        pref_min_height_cm=_floats(people, 'min_height_cm'),
        pref_max_height_cm=_floats(people, 'max_height_cm'),
        pref_distance=_floats(people, 'distance'),
        pref_last_online_id=_ints(people, 'last_online_id', DEFAULT_LAST_ONLINE_ID),
        pref_two_way=np.array(
            [[bool(p[f]) for f in spec.pref_two_way_fields] for p in people],
            np.float32),
    )
