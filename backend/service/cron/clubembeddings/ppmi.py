import logging
import numpy
import numpy.typing as npt
from collections.abc import Callable, Mapping, Sequence

logger = logging.getLogger(__name__)

DIMENSIONS = 64

_OVERSAMPLED_DIMENSIONS = 128
_POWER_ITERATIONS = 6

_SVD_SEED = 0

_MATMUL_BLOCK = 16

_MIN_CLUB_MEMBERS = 10

_GRADIENT_STEPS = 16
_FOLD_IN_RIDGE = 1e-3
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


def _randomized_svd_row_factors(
    matmul: SparseMatmul,
    matrix_size: int,
    seed: int,
) -> FloatArray:
    k = min(DIMENSIONS, matrix_size)
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
    logger.info('cold start: computing the final decomposition')
    b = matmul(q).T
    _, s, vt = numpy.linalg.svd(b, full_matrices=False)
    w = (vt[:k].T * numpy.sqrt(s[:k])).astype(numpy.float32)

    if k < DIMENSIONS:
        w = numpy.pad(w, ((0, 0), (0, DIMENSIONS - k)))

    return w


def _fold_in(
    w: FloatArray,
    matmul: SparseMatmul,
    indexes: npt.NDArray[numpy.int64],
) -> FloatArray:
    if len(indexes) == 0:
        return w

    gram = (w.T @ w).astype(numpy.float64)
    ridge = _FOLD_IN_RIDGE * max(float(numpy.trace(gram)) / DIMENSIONS, 1.0)
    regularized = gram + ridge * numpy.eye(DIMENSIONS)
    targets = matmul(w)[indexes].astype(numpy.float64)

    w = w.copy()
    w[indexes] = numpy.linalg.solve(
        regularized, targets.T).T.astype(numpy.float32)
    return w


def _exact_line_search(
    w: FloatArray,
    grad: FloatArray,
    m_w: FloatArray,
    m_grad: FloatArray,
) -> float:
    p = (w.T @ w).astype(numpy.float64)
    c = (w.T @ grad + grad.T @ w).astype(numpy.float64)
    r = (grad.T @ grad).astype(numpy.float64)

    m_wg = float((w.astype(numpy.float64) *
                  m_grad.astype(numpy.float64)).sum())
    m_gg = float((grad.astype(numpy.float64) *
                  m_grad.astype(numpy.float64)).sum())

    c0 = -2 * float((p * c).sum()) + 4 * m_wg
    c1 = 2 * (float((c * c).sum()) + 2 * float((p * r).sum())) - 4 * m_gg
    c2 = -6 * float((c * r).sum())
    c3 = 4 * float((r * r).sum())

    if c0 >= 0 or c3 <= 0:
        return 0.0

    def phi(t: float) -> float:
        return (c0 * t
                + c1 * t * t / 2
                + c2 * t ** 3 / 3
                + c3 * t ** 4 / 4)

    candidates = [
        float(t.real)
        for t in numpy.roots([c3, c2, c1, c0])
        if abs(t.imag) < 1e-9 * (abs(t.real) + 1e-30) and t.real > 0
    ]
    if not candidates:
        return 0.0

    return min(candidates, key=phi)


def _warm_started_row_factors(
    matmul: SparseMatmul,
    w0: FloatArray,
    steps: int,
) -> FloatArray:
    w = w0.copy()
    for step in range(steps):
        logger.info(f'warm start: step {step + 1}/{steps}: started')
        m_w = matmul(w)
        grad = 4 * (w @ (w.T @ w) - m_w)
        grad_scale = float((grad * grad).sum())
        if grad_scale <= 1e-12 * max(float((w * w).sum()), 1.0):
            logger.info(
                f'warm start: converged after {step} of {steps} steps')
            break
        m_grad = matmul(grad)
        t = _exact_line_search(w, grad, m_w, m_grad)
        if t <= 0:
            logger.info(
                f'warm start: no descent after {step} of {steps} steps')
            break
        w = (w - t * grad).astype(numpy.float32)
        logger.info(
            f'warm start: step {step + 1}/{steps}: '
            f'gradient norm {grad_scale ** 0.5:.6g}, '
            f'step size {t:.6g}')
    return w


def club_embeddings_from_memberships(
    memberships: Sequence[Membership],
    previous: Mapping[str, FloatArray],
    seed: int = _SVD_SEED,
    steps: int = _GRADIENT_STEPS,
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
    total = counts.sum() * 2
    pmi = numpy.log(counts * total / (marginals[ci] * marginals[cj]))
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
        f'factorizing {len(ppmi)} positive ppmi pairs over '
        f'{len(embedded)} clubs; '
        f'{len(known)} have previous embeddings')

    if len(known) < _WARM_START_MIN_COVERAGE * len(embedded):
        logger.info('strategy: cold start (randomized svd)')
        w = _randomized_svd_row_factors(matmul, club_count, seed)
    else:
        logger.info('strategy: warm start (gradient descent)')
        w0 = numpy.zeros((club_count, DIMENSIONS), dtype=numpy.float32)
        for i in known:
            w0[i] = previous[str(unique_clubs[i])]
        new = numpy.array([
            i for i in embedded if str(unique_clubs[i]) not in previous
        ], dtype=numpy.int64)
        logger.info(f'folding in {len(new)} new clubs')
        w0 = _fold_in(w0, matmul, new)
        w = _warm_started_row_factors(matmul, w0, steps)

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
