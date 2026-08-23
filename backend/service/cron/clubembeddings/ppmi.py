import logging
import numpy
import numpy.typing as npt
from collections.abc import Callable, Mapping, Sequence
from serviceshared.duoenv.cron import CLUB_EMBEDDINGS_SMOOTHING

logger = logging.getLogger(__name__)

DIMENSIONS = 64

_PPMI_SHIFT = float(numpy.log(2))

_MIN_CLUB_MEMBERS = 10

_OVERSAMPLED_DIMENSIONS = 128
_POWER_ITERATIONS = 6

_SVD_SEED = 0

_MATMUL_BLOCK = 16

_SUBSPACE_STEPS = 16
_WARM_PROBE_COLUMNS = 16
_CONVERGED_SUBSPACE_DRIFT = 1e-9
_WARM_START_MIN_COVERAGE = 0.5

_UNCHANGED_MIN_COSINE = 0.999
_UNCHANGED_MAX_NORM_DRIFT = 1e-2

FloatArray = npt.NDArray[numpy.float32]

Membership = tuple[int, str]

SparseMatmul = Callable[[FloatArray], FloatArray]


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


def _sparse_matmul(
    rows: npt.NDArray[numpy.int64],
    cols: npt.NDArray[numpy.int64],
    vals: FloatArray,
    matrix_size: int,
) -> SparseMatmul:
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

    return matmul


def _top_positive_columns(
    w: FloatArray,
    matmul: SparseMatmul,
) -> FloatArray:
    rayleigh = w.T @ matmul(w)
    rayleigh = ((rayleigh + rayleigh.T) / 2).astype(numpy.float64)
    eigenvalues, rotation = numpy.linalg.eigh(rayleigh)
    rotated = w @ rotation.astype(numpy.float32)

    floor = 1e-6 * float(numpy.abs(eigenvalues).max())
    keep = [
        i for i in numpy.argsort(-eigenvalues)
        if eigenvalues[i] > floor
    ][:DIMENSIONS]

    out = numpy.zeros((w.shape[0], DIMENSIONS), dtype=numpy.float32)
    out[:, :len(keep)] = rotated[:, keep]
    return out


def _randomized_subspace(
    matmul: SparseMatmul,
    matrix_size: int,
    seed: int,
) -> FloatArray:
    oversampled = min(_OVERSAMPLED_DIMENSIONS, matrix_size)

    rng = numpy.random.default_rng(seed)
    probes = rng.standard_normal(
        (matrix_size, oversampled)).astype(numpy.float32)
    logger.info('cold start: projecting probes')
    q, _ = numpy.linalg.qr(matmul(probes))
    for i in range(_POWER_ITERATIONS):
        logger.info(
            f'cold start: power iteration {i + 1}/{_POWER_ITERATIONS}: '
            f'started')
        q, _ = numpy.linalg.qr(matmul(q))
    return q.astype(numpy.float32)


def _subspace_iteration(
    matmul: SparseMatmul,
    w0: FloatArray,
    steps: int,
    seed: int,
) -> FloatArray:
    rng = numpy.random.default_rng(seed)
    probes = rng.standard_normal(
        (w0.shape[0], min(_WARM_PROBE_COLUMNS, w0.shape[0]))
    ).astype(numpy.float32)
    q, _ = numpy.linalg.qr(
        numpy.concatenate([w0, probes], axis=1))
    q = q.astype(numpy.float32)
    for step in range(steps):
        logger.info(f'warm start: step {step + 1}/{steps}: started')
        refreshed, _ = numpy.linalg.qr(matmul(q))
        refreshed = refreshed.astype(numpy.float32)
        overlap = float(
            (numpy.linalg.norm(refreshed.T @ q, ord='fro')) ** 2)
        drift = max(0.0, q.shape[1] - overlap)
        q = refreshed
        logger.info(
            f'warm start: step {step + 1}/{steps}: '
            f'subspace drift {drift:.3g}')
        if drift < _CONVERGED_SUBSPACE_DRIFT:
            logger.info(
                f'warm start: converged after {step + 1} of {steps} steps')
            break
    return q


def _aligned_to_previous(
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
    steps: int = _SUBSPACE_STEPS,
) -> dict[str, FloatArray]:
    if not memberships:
        return {}

    logger.info(
        f'building the co-occurrence matrix '
        f'from {len(memberships)} memberships')

    person_ids = numpy.array([p for p, _ in memberships], dtype=numpy.int64)
    club_names = numpy.array([c for _, c in memberships], dtype=object)

    all_clubs, all_club_index = numpy.unique(club_names, return_inverse=True)
    club_eligible = numpy.bincount(all_club_index) >= _MIN_CLUB_MEMBERS
    zeroed = {
        str(name): numpy.zeros(DIMENSIONS, dtype=numpy.float32)
        for name in all_clubs[~club_eligible]
        if str(name) in previous
    }
    logger.info(
        f'excluded {int((~club_eligible).sum())} clubs with fewer than '
        f'{_MIN_CLUB_MEMBERS} members; zeroing {len(zeroed)} of them')
    kept = club_eligible[all_club_index]
    person_ids = person_ids[kept]
    club_names = club_names[kept]
    if len(person_ids) == 0:
        return zeroed

    _, person_index = numpy.unique(person_ids, return_inverse=True)
    unique_clubs, club_index = numpy.unique(club_names, return_inverse=True)
    club_count = len(unique_clubs)

    person_order = numpy.argsort(person_index, kind='stable')
    clubs_by_person_order = club_index[person_order].astype(numpy.int64)
    _, person_starts = numpy.unique(
        person_index[person_order], return_index=True)

    pair_keys = _cooccurrence_pair_keys(clubs_by_person_order, person_starts)
    if len(pair_keys) == 0:
        return zeroed

    unique_keys, counts_ = numpy.unique(pair_keys, return_counts=True)
    ci = (unique_keys >> numpy.uint64(32)).astype(numpy.int64)
    cj = (unique_keys & numpy.uint64(0xFFFFFFFF)).astype(numpy.int64)
    counts = counts_.astype(numpy.float64)

    marginals = numpy.clip(
        numpy.bincount(ci, weights=counts, minlength=club_count) +
        numpy.bincount(cj, weights=counts, minlength=club_count),
        1,
        None,
    )
    smoothed = marginals ** CLUB_EMBEDDINGS_SMOOTHING
    total = counts.sum() * 2 * smoothed.sum() / marginals.sum()
    pmi = numpy.log(counts * total / (smoothed[ci] * smoothed[cj]))
    pmi -= _PPMI_SHIFT
    positive = pmi > 0
    if not positive.any():
        return zeroed

    ci, cj = ci[positive], cj[positive]
    ppmi = pmi[positive].astype(numpy.float32)

    matmul = _sparse_matmul(
        rows=numpy.concatenate([ci, cj]),
        cols=numpy.concatenate([cj, ci]),
        vals=numpy.concatenate([ppmi, ppmi]),
        matrix_size=club_count,
    )

    embedded = numpy.unique(numpy.concatenate([ci, cj]))
    known = numpy.array([
        i for i in embedded if str(unique_clubs[i]) in previous
    ], dtype=numpy.int64)
    logger.info(
        f'factorizing {len(ppmi)} shifted ppmi pairs over '
        f'{len(embedded)} clubs (smoothing {CLUB_EMBEDDINGS_SMOOTHING}, '
        f'shift {_PPMI_SHIFT:.3f}); '
        f'{len(known)} have previous embeddings')

    if len(known) < _WARM_START_MIN_COVERAGE * len(embedded):
        logger.info('strategy: cold start (randomized subspace)')
        w = _randomized_subspace(matmul, club_count, seed)
    else:
        logger.info('strategy: warm start (subspace iteration)')
        w0 = numpy.zeros((club_count, DIMENSIONS), dtype=numpy.float32)
        for i in known:
            w0[i] = previous[str(unique_clubs[i])]
        w = _subspace_iteration(matmul, w0, steps, seed)

    w = _top_positive_columns(w, matmul)

    w = _aligned_to_previous(w, [str(c) for c in unique_clubs], previous)

    embedded_names = {str(unique_clubs[i]) for i in embedded}
    for name in unique_clubs:
        if str(name) not in embedded_names and str(name) in previous:
            zeroed[str(name)] = numpy.zeros(
                DIMENSIONS, dtype=numpy.float32)

    return {str(unique_clubs[i]): w[i] for i in embedded} | zeroed


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
