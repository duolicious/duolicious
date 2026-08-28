"""Build the matching model's inputs from live database rows.

This has to agree with the training-time feature construction
(backend/kvmatching/features.py) exactly: the encoders were fitted against
that layout, and a column out of place produces plausible-looking nonsense
rather than an error. `kvmatching/verify_serving.py` checks the two agree.

The vocabulary (question ids, enum sizes, the country list) is
frozen into the weight artifact, so it only moves when a new model is
deployed. Counts encode as bucketed one-hots with zero left implicit,
binary facts as single flags, and smooth physical quantities (year of
birth, height, coordinates) as scalars: the scalars extrapolate to values
outside the training range, which matters for the birth years that only
start appearing between retrains.
"""
import re

import numpy as np
import numpy.typing as npt

from serviceshared.kvmatching.blocks import Blocks, F64Array, FloatArray, IntArray
from serviceshared.kvmatching.spec import Spec

BIRTH_YEAR_CENTRE, BIRTH_YEAR_SCALE = 1995.0, 10.0
HEIGHT_LO, HEIGHT_HI, HEIGHT_CENTRE, HEIGHT_SCALE = 120.0, 230.0, 170.0, 10.0
BEH_RECEIVED_EDGES = [3, 10, 41, 200]
BEH_SENT_EDGES = [3, 6, 14, 35]
BEH_MESSAGES_EDGES = [4, 9, 51, 255]
BEH_RATE_EDGES = [0.0, 0.25, 0.6]
N_VERIFICATION = 4
PHOTO_EDGES = [1, 2, 3, 4]
FLESCH_EDGES = [60.0, 90.0]
CLUB_EDGES = [3, 9, 19, 40]
_VOWELS = set('aeiouy')
_WORD_RE = re.compile(r"[a-zA-Z']+")
_SENTENCE_RE = re.compile(r'[.!?\n]+')
PREF_NUMS = ((25.0, 10.0), (40.0, 10.0), (160.0, 10.0), (190.0, 10.0))
N_LAST_ONLINE = 6


def one_hot(values: IntArray, size: int) -> FloatArray:
    out = np.zeros((len(values), size), np.float32)
    ok = (values >= 0) & (values < size)
    out[np.flatnonzero(ok), values[ok]] = 1.0
    return out


def fourier_latlon(lat: F64Array, lon: F64Array, freqs: IntArray) -> FloatArray:
    a = np.deg2rad(lat)[:, None]
    b = np.deg2rad(lon)[:, None]
    f = freqs.astype(np.float64)[None, :]
    return np.concatenate(
        [np.sin(a * f), np.cos(a * f), np.sin(b * f), np.cos(b * f)], axis=1
    ).astype(np.float32)


def numeric(birth_year: F64Array, height: F64Array) -> tuple[FloatArray, FloatArray]:
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


def _count_bucketed(values: IntArray, edges: list[int]) -> FloatArray:
    """A count as a one-hot over bands, with zero left all-zero: a zeroed
    block stays exactly a brand-new user."""
    out = np.zeros((len(values), len(edges) + 1), np.float32)
    pos = values > 0
    idx = (values[pos, None] >= np.array(edges)[None, :]).sum(axis=1)
    out[np.flatnonzero(pos), idx] = 1.0
    return out


def behaviour_features(intros_received: IntArray, intros_replied: IntArray,
                       intros_sent: IntArray,
                       messages_received: IntArray) -> FloatArray:
    """How the person has messaged and been messaged, from the four counters
    the chat path maintains (backend/service/api/chat). All are counts of
    events, so none of these go stale with the mere passage of time, and an
    all-zero block is exactly a brand-new user, which training simulates by
    zeroing the block (`Noise.p_beh`)."""
    received = intros_received.astype(np.int64)
    replied = intros_replied.astype(np.int64)
    defined = received > 0
    rate = np.where(defined, replied / np.maximum(received, 1), 0.0)
    rate_bucket = np.zeros((len(received), len(BEH_RATE_EDGES) + 2), np.float32)
    idx = (rate[:, None] > np.array(BEH_RATE_EDGES)[None, :]).sum(axis=1)
    idx = np.where(rate >= 1.0, len(BEH_RATE_EDGES) + 1, idx)
    rate_bucket[np.flatnonzero(defined), idx[defined]] = 1.0
    return np.concatenate([
        _count_bucketed(received, BEH_RECEIVED_EDGES),
        _count_bucketed(intros_sent, BEH_SENT_EDGES),
        _count_bucketed(messages_received, BEH_MESSAGES_EDGES),
        _count_bucketed(received - replied, BEH_RECEIVED_EDGES),
        rate_bucket,
    ], axis=1)


def _syllables(word: str) -> int:
    prev = False
    n = 0
    for c in word:
        v = c in _VOWELS
        n += v and not prev
        prev = v
    if word.endswith('e') and n > 1:
        n -= 1
    return max(n, 1)


def flesch_reading_ease(text: str) -> float | None:
    words = _WORD_RE.findall(text.lower())
    if not words:
        return None
    sentences = max(len(_SENTENCE_RE.findall(text)), 1)
    syllables = sum(_syllables(w) for w in words)
    return (206.835 - 1.015 * len(words) / sentences
            - 84.6 * syllables / len(words))


def profile_quality_features(verification_level_id: IntArray,
                             about: list[str | None],
                             photo_count: IntArray,
                             club_count: IntArray) -> FloatArray:
    """How much of a profile there is: the verification level, whether the
    bio strays outside ascii, how many photos, how readable the bio is (a
    missing or wordless bio is its own band), and how many clubs joined."""
    n = len(about)
    non_ascii = np.zeros(n, np.float32)
    fre_bucket = np.zeros((n, len(FLESCH_EDGES) + 2), np.float32)
    for i, text in enumerate(about):
        score = flesch_reading_ease(text) if text is not None else None
        if score is None:
            fre_bucket[i, 0] = 1.0
        else:
            fre_bucket[i, 1 + sum(score >= e for e in FLESCH_EDGES)] = 1.0
        if text is not None:
            non_ascii[i] = any(ord(c) > 127 for c in text)
    return np.concatenate([
        one_hot(verification_level_id, N_VERIFICATION),
        non_ascii[:, None],
        one_hot(np.minimum(photo_count, len(PHOTO_EDGES)),
                 len(PHOTO_EDGES) + 1),
        fre_bucket,
        _count_bucketed(club_count, CLUB_EDGES),
    ], axis=1)


def who_input(spec: Spec, b: Blocks) -> FloatArray:
    cats = [
        one_hot(values, int(size))
        for values, size in zip(b.cats, spec.cat_sizes)
    ]
    num, num_mask = numeric(b.birth_year, b.height_cm)
    return np.concatenate([
        b.answers,
        *cats,
        num * num_mask, num_mask,
        fourier_latlon(b.lat, b.lon, spec.loc_freqs),
        one_hot(b.country, len(spec.countries) + 1),
        behaviour_features(b.intros_received, b.intros_replied,
                           b.intros_sent, b.messages_received),
        profile_quality_features(b.verification_level_id, b.about,
                                 b.photo_count, b.club_count),
    ], axis=1).astype(np.float32)


def pref_numeric(min_age: F64Array, max_age: F64Array,
                 min_height_cm: F64Array, max_height_cm: F64Array,
                 distance: F64Array,
                 last_online_id: IntArray) -> tuple[FloatArray, FloatArray]:
    cols: list[F64Array] = []
    masks: list[npt.NDArray[np.bool_]] = []
    columns = [min_age, max_age, min_height_cm, max_height_cm]
    for v, (centre, scale) in zip(columns, PREF_NUMS):
        m = ~np.isnan(v)
        v = np.clip(np.where(m, v, centre), centre - 6 * scale, centre + 6 * scale)
        cols.append(np.where(m, (v - centre) / scale, 0.0))
        masks.append(m)
    dm = ~np.isnan(distance)
    cols.append(np.where(dm, (np.log1p(np.where(dm, distance, 1.0)) - 6.0) / 2.0, 0.0))
    masks.append(dm)
    lo = one_hot(last_online_id, N_LAST_ONLINE)
    num = np.concatenate([np.stack(cols, 1), lo], axis=1)
    mask = np.concatenate([np.stack(masks, 1), np.ones_like(lo)], axis=1)
    return num.astype(np.float32), mask.astype(np.float32)


def look_input(spec: Spec, b: Blocks) -> FloatArray:
    pref_num, pref_mask = pref_numeric(
        b.pref_min_age, b.pref_max_age, b.pref_min_height_cm,
        b.pref_max_height_cm, b.pref_distance, b.pref_last_online_id)
    return np.concatenate([
        who_input(spec, b),
        b.pref_answers,
        b.pref_multi,
        pref_num * pref_mask, pref_mask,
        b.pref_two_way,
    ], axis=1).astype(np.float32)
