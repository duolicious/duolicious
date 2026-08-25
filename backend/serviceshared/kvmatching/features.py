"""Build the matching model's inputs from live database rows.

This has to agree with the training-time feature construction
(backend/kvmatching/features.py) exactly: the encoders were fitted against
that layout, and a column out of place produces plausible-looking nonsense
rather than an error. `kvmatching/verify_serving.py` checks the two agree.

The vocabulary (question ids, enum sizes, the country list) is
frozen into the weight artifact, so it only moves when a new model is
deployed.
"""
import numpy as np
import numpy.typing as npt

from serviceshared.kvmatching.blocks import Blocks, F64Array, FloatArray, IntArray
from serviceshared.kvmatching.spec import Spec

BIRTH_YEAR_CENTRE, BIRTH_YEAR_SCALE = 1995.0, 10.0
HEIGHT_LO, HEIGHT_HI, HEIGHT_CENTRE, HEIGHT_SCALE = 120.0, 230.0, 170.0, 10.0
PREF_NUMS = (
    ("min_age", 25.0, 10.0),
    ("max_age", 40.0, 10.0),
    ("min_height_cm", 160.0, 10.0),
    ("max_height_cm", 190.0, 10.0),
)
N_LAST_ONLINE = 6


def _one_hot(values: IntArray, size: int) -> FloatArray:
    out = np.zeros((len(values), size), np.float32)
    ok = (values >= 0) & (values < size)
    out[np.flatnonzero(ok), values[ok]] = 1.0
    return out


def _fourier_latlon(lat: F64Array, lon: F64Array, freqs: IntArray) -> FloatArray:
    a = np.deg2rad(lat)[:, None]
    b = np.deg2rad(lon)[:, None]
    f = freqs.astype(np.float64)[None, :]
    return np.concatenate(
        [np.sin(a * f), np.cos(a * f), np.sin(b * f), np.cos(b * f)], axis=1
    ).astype(np.float32)


def _numeric(birth_year: F64Array, height: F64Array) -> tuple[FloatArray, FloatArray]:
    y = np.clip(birth_year,
                BIRTH_YEAR_CENTRE - 6 * BIRTH_YEAR_SCALE,
                BIRTH_YEAR_CENTRE + 6 * BIRTH_YEAR_SCALE)
    h = height
    hm = ~np.isnan(h) & (h >= HEIGHT_LO) & (h <= HEIGHT_HI)
    h = np.where(hm, h, HEIGHT_CENTRE)
    num = np.stack([(y - BIRTH_YEAR_CENTRE) / BIRTH_YEAR_SCALE,
                    (h - HEIGHT_CENTRE) / HEIGHT_SCALE], axis=1)
    mask = np.stack([np.ones(len(y)), hm], axis=1)
    return num.astype(np.float32), mask.astype(np.float32)


def who_input(spec: Spec, b: Blocks) -> FloatArray:
    cats = [
        _one_hot(values, int(size))
        for values, size in zip(b.cats, spec.cat_sizes)
    ]
    num, num_mask = _numeric(b.birth_year, b.height_cm)
    return np.concatenate([
        b.answers,
        *cats,
        num * num_mask, num_mask,
        _fourier_latlon(b.lat, b.lon, spec.loc_freqs),
        _one_hot(b.country, len(spec.countries) + 1),
    ], axis=1).astype(np.float32)


def _pref_numeric(b: Blocks) -> tuple[FloatArray, FloatArray]:
    cols: list[F64Array] = []
    masks: list[npt.NDArray[np.bool_]] = []
    for v, (_, centre, scale) in zip(b.pref_numeric_columns(), PREF_NUMS):
        m = ~np.isnan(v)
        v = np.clip(np.where(m, v, centre), centre - 6 * scale, centre + 6 * scale)
        cols.append(np.where(m, (v - centre) / scale, 0.0))
        masks.append(m)
    d = b.pref_distance
    dm = ~np.isnan(d)
    cols.append(np.where(dm, (np.log1p(np.where(dm, d, 1.0)) - 6.0) / 2.0, 0.0))
    masks.append(dm)
    lo = _one_hot(b.pref_last_online_id, N_LAST_ONLINE)
    num = np.concatenate([np.stack(cols, 1), lo], axis=1)
    mask = np.concatenate([np.stack(masks, 1), np.ones_like(lo)], axis=1)
    return num.astype(np.float32), mask.astype(np.float32)


def look_input(spec: Spec, b: Blocks) -> FloatArray:
    pref_num, pref_mask = _pref_numeric(b)
    return np.concatenate([
        who_input(spec, b),
        b.pref_answers,
        b.pref_multi,
        pref_num * pref_mask, pref_mask,
        b.pref_two_way,
    ], axis=1).astype(np.float32)
