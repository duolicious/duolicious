"""Turn database rows into the dense blocks the encoders consume."""
import numpy as np

from serviceshared.kvmatching.blocks import Blocks, F64Array, FloatArray, IntArray
from serviceshared.kvmatching.spec import Spec

Row = dict[str, object]
Triple = tuple[int, int, bool]

# training filled missing enum values with 1, the "Unanswered" member
UNANSWERED = 1
DEFAULT_LAST_ONLINE_ID = 4


def _int(v: object) -> int:
    if isinstance(v, bool) or not isinstance(v, int):
        raise RuntimeError(f'expected an integer, got {type(v).__name__}')
    return v


def _float(v: object) -> float:
    if v is None:
        return float('nan')
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise RuntimeError(f'expected a number, got {type(v).__name__}')
    return float(v)


def _int_list(v: object) -> list[int]:
    if v is None:
        return []
    if not isinstance(v, list):
        raise RuntimeError(f'expected a list, got {type(v).__name__}')
    return [_int(x) for x in v]


def _floats(people: list[Row], name: str) -> F64Array:
    return np.array([_float(p[name]) for p in people], np.float64)


def _ints(people: list[Row], name: str, default: int) -> IntArray:
    return np.array(
        [default if p[name] is None else _int(p[name]) for p in people],
        np.int64)


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
        for v in _int_list(p[field]):
            if 0 <= v < size:
                out[i, v] = 1.0
    return out


def build(spec: Spec, people: list[Row], answers: list[Triple],
          pref_answers: list[Triple]) -> Blocks:
    n = len(people)
    person_ids = np.array([_int(p['id']) for p in people], np.int64)
    index = {int(pid): i for i, pid in enumerate(person_ids)}

    country = np.array(
        [spec.country_column.get(str(p['country'] or ''), 0) for p in people],
        np.int64)

    return Blocks(
        person_ids=person_ids,
        birth_year=_floats(people, 'birth_year'),
        height_cm=_floats(people, 'height_cm'),
        lat=_floats(people, 'lat'),
        lon=_floats(people, 'lon'),
        answers=_sparse_pm1(spec, index, answers, n),
        cats=[_ints(people, f, UNANSWERED) for f in spec.cat_fields],
        country=country,
        intros_received=_ints(people, 'count_intros_received', 0),
        intros_replied=_ints(people, 'count_intros_replied', 0),
        intros_sent=_ints(people, 'count_intros_sent', 0),
        messages_received=_ints(people, 'count_messages_received', 0),
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
