import numpy
import numpy.typing as npt
from collections.abc import Mapping, Sequence

DIMENSIONS = 64

_OVERSAMPLED_DIMENSIONS = 128
_POWER_ITERATIONS = 6

_SVD_SEED = 0

_MATMUL_BLOCK = 16

_UNCHANGED_MIN_COSINE = 0.9995
_UNCHANGED_MAX_NORM_DRIFT = 1e-3

FloatArray = npt.NDArray[numpy.float32]

Membership = tuple[int, str]


def _cooccurrence_pair_keys(
    clubs_by_person_order: npt.NDArray[numpy.int64],
    person_starts: npt.NDArray[numpy.int64],
) -> npt.NDArray[numpy.uint64]:
    clubs_per_person = numpy.diff(
        numpy.append(person_starts, len(clubs_by_person_order)))

    pair_chunks = []
    for k in numpy.unique(clubs_per_person):
        if k < 2:
            continue
        starts = person_starts[clubs_per_person == k]
        club_lists = clubs_by_person_order[
            starts[:, None] + numpy.arange(k)[None, :]
        ]
        iu, ju = numpy.triu_indices(k, 1)
        a = club_lists[:, iu].ravel().astype(numpy.uint64)
        b = club_lists[:, ju].ravel().astype(numpy.uint64)
        lo = numpy.minimum(a, b)
        hi = numpy.maximum(a, b)
        pair_chunks.append(lo << numpy.uint64(32) | hi)

    if not pair_chunks:
        return numpy.array([], dtype=numpy.uint64)

    return numpy.concatenate(pair_chunks)


def _randomized_svd_row_factors(
    rows: npt.NDArray[numpy.int64],
    cols: npt.NDArray[numpy.int64],
    vals: FloatArray,
    matrix_size: int,
    seed: int,
) -> FloatArray:
    order = numpy.argsort(rows, kind='stable')
    rows, cols, vals = rows[order], cols[order], vals[order]
    row_uniq, row_starts = numpy.unique(rows, return_index=True)

    def matmul(x: FloatArray) -> FloatArray:
        out = numpy.zeros((matrix_size, x.shape[1]), dtype=numpy.float32)
        for i in range(0, x.shape[1], _MATMUL_BLOCK):
            part = vals[:, None] * x[cols, i:i + _MATMUL_BLOCK]
            out[row_uniq, i:i + _MATMUL_BLOCK] = numpy.add.reduceat(
                part, row_starts, axis=0)
        return out

    k = min(DIMENSIONS, matrix_size)
    oversampled = min(_OVERSAMPLED_DIMENSIONS, matrix_size)

    rng = numpy.random.default_rng(seed)
    probes = rng.standard_normal(
        (matrix_size, oversampled)).astype(numpy.float32)
    q, _ = numpy.linalg.qr(matmul(probes))
    for _ in range(_POWER_ITERATIONS):
        q, _ = numpy.linalg.qr(matmul(q))
    b = matmul(q).T
    _, s, vt = numpy.linalg.svd(b, full_matrices=False)
    w = (vt[:k].T * numpy.sqrt(s[:k])).astype(numpy.float32)

    if k < DIMENSIONS:
        w = numpy.pad(w, ((0, 0), (0, DIMENSIONS - k)))

    return w


def _align_to_previous(
    w: FloatArray,
    club_names: Sequence[str],
    previous: Mapping[str, FloatArray],
) -> FloatArray:
    common = [
        (i, previous[name])
        for i, name in enumerate(club_names)
        if name in previous
    ]
    if not common:
        return w

    indexes = [i for i, _ in common]
    w_old = numpy.stack([vec for _, vec in common])
    u, _, vt = numpy.linalg.svd(w[indexes].T @ w_old)
    rotation = (u @ vt).astype(numpy.float32)

    return w @ rotation


def club_embeddings_from_memberships(
    memberships: Sequence[Membership],
    previous: Mapping[str, FloatArray],
    seed: int = _SVD_SEED,
) -> dict[str, FloatArray]:
    if not memberships:
        return {}

    person_ids = numpy.array([p for p, _ in memberships], dtype=numpy.int64)
    club_names = numpy.array([c for _, c in memberships], dtype=object)

    _, person_index = numpy.unique(person_ids, return_inverse=True)
    unique_clubs, club_index = numpy.unique(club_names, return_inverse=True)
    club_count = len(unique_clubs)

    person_order = numpy.argsort(person_index, kind='stable')
    clubs_by_person_order = club_index[person_order].astype(numpy.int64)
    _, person_starts = numpy.unique(
        person_index[person_order], return_index=True)

    pair_keys = _cooccurrence_pair_keys(clubs_by_person_order, person_starts)
    if len(pair_keys) == 0:
        return {}

    unique_keys, counts_ = numpy.unique(pair_keys, return_counts=True)
    ci = (unique_keys >> numpy.uint64(32)).astype(numpy.int64)
    cj = (unique_keys & numpy.uint64(0xFFFFFFFF)).astype(numpy.int64)
    counts = counts_.astype(numpy.float64)

    total = counts.sum() * 2
    marginals = numpy.clip(
        numpy.bincount(ci, weights=counts, minlength=club_count) +
        numpy.bincount(cj, weights=counts, minlength=club_count),
        1,
        None,
    )
    pmi = numpy.log(counts * total / (marginals[ci] * marginals[cj]))
    positive = pmi > 0
    if not positive.any():
        return {}

    ci, cj = ci[positive], cj[positive]
    ppmi = pmi[positive].astype(numpy.float32)

    w = _randomized_svd_row_factors(
        rows=numpy.concatenate([ci, cj]),
        cols=numpy.concatenate([cj, ci]),
        vals=numpy.concatenate([ppmi, ppmi]),
        matrix_size=club_count,
        seed=seed,
    )
    w = _align_to_previous(w, list(unique_clubs), previous)

    embedded = numpy.unique(numpy.concatenate([ci, cj]))
    return {str(unique_clubs[i]): w[i] for i in embedded}


def _materially_moved(new: FloatArray, old: FloatArray) -> bool:
    new_norm = float(numpy.linalg.norm(new))
    old_norm = float(numpy.linalg.norm(old))
    if new_norm == 0 or old_norm == 0:
        return new_norm != old_norm
    if abs(new_norm / old_norm - 1) > _UNCHANGED_MAX_NORM_DRIFT:
        return True
    cosine = float(new @ old) / (new_norm * old_norm)
    return cosine < _UNCHANGED_MIN_COSINE


def changed_embeddings(
    new: Mapping[str, FloatArray],
    previous: Mapping[str, FloatArray],
) -> dict[str, FloatArray]:
    return {
        name: vec
        for name, vec in new.items()
        if name not in previous or _materially_moved(vec, previous[name])
    }
