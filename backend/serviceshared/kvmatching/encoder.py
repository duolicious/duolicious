"""Pure-numpy inference for the trained key-value encoders. No torch: the
weights are a frozen artifact shipped with a deployment, so serving only ever
runs this forward pass.

Each encoder is Linear -> (LayerNorm -> ReLU -> Linear) x N -> (vector head,
bias head); the artifact carries however many tail layers training used.

The first Linear is integer arithmetic: its weights ship as whole numbers of
W0_QUANTUM and its inputs are rounded to whole numbers of INPUT_QUANTUM, so
its output is a whole number of PRE_QUANTUM and the floating point starts at
the head. That is what lets a person's first-layer sum be cached and patched
one column at a time -- adding a column is adding integers, exact however
many times it happens -- while the rest of the forward pass is a fixed-size
tail.
"""
import numpy as np

EPS = 1e-5

LATENT_DIMS = 64
HALF_DIMS = LATENT_DIMS + 2
STORED_DIMS = 2 * HALF_DIMS

W0_QUANTUM = 2.0 ** -13
INPUT_QUANTUM = 2.0 ** -8
PRE_QUANTUM = W0_QUANTUM * INPUT_QUANTUM
# An input of 1.0 -- an answered question, a set flag -- in input steps.
INPUT_UNIT = round(1.0 / INPUT_QUANTUM)


def to_steps(x: np.ndarray) -> np.ndarray:
    return np.rint(x / INPUT_QUANTUM).astype(np.int32)


def relu(x: np.ndarray) -> np.ndarray:
    return np.maximum(x, 0.0)


class Encoder:
    def __init__(self, w: dict, prefix: str, out_dims: int,
                 answer_blocks: list[tuple[int, int]]):
        # stored float16, used float32: numpy has no fast float16 matmul
        g = lambda n: w[f'{prefix}.{n}'].astype(np.float32)
        self.w0 = w[f'{prefix}.w0'].astype(np.int32)
        self.b0 = g('b0')
        self.answer_blocks = answer_blocks
        answered = np.concatenate(
            [np.arange(start, stop) for start, stop in answer_blocks])
        self.live_columns = np.setdiff1d(np.arange(self.w0.shape[1]), answered)
        self.w0_live = np.ascontiguousarray(self.w0[:, self.live_columns])
        self.tail = []
        t = 1
        while f'{prefix}.w{t}' in w:
            self.tail.append((g(f'ln_g{t}'), g(f'ln_b{t}'), g(f'w{t}'), g(f'b{t}')))
            t += 1
        self.wmu = g('wmu')
        self.bmu = g('bmu')
        self.wbias = g('wbias')
        self.bbias = g('bbias')
        self.out_dims = out_dims

    def pre(self, x: np.ndarray) -> np.ndarray:
        """First-layer sum over the whole input, in whole PRE_QUANTUM."""
        return self.pre_live(x) + self.pre_answers(x)

    def pre_live(self, x: np.ndarray) -> np.ndarray:
        """The columns a refresh re-reads: everything but the answer blocks,
        which is where the input a person can change without bound lives."""
        return to_steps(x[..., self.live_columns]) @ self.w0_live.T

    def pre_answers(self, x: np.ndarray) -> np.ndarray:
        """The answer blocks' share: what `person.kv_who_pre` caches."""
        return sum(to_steps(x[..., start:stop]) @ self.w0[:, start:stop].T
                   for start, stop in self.answer_blocks)

    def pre_delta(self, pre: np.ndarray, column: int, delta: int) -> np.ndarray:
        """Apply a single changed input coordinate, in input steps."""
        return pre + self.w0[:, column] * delta

    def head(self, pre: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Fixed-size tail: returns (vector, bias scalar)."""
        h = pre.astype(np.float32) * PRE_QUANTUM + self.b0
        for ln_g, ln_b, wt, bt in self.tail:
            mu = h.mean(-1, keepdims=True)
            var = h.var(-1, keepdims=True)
            h = (h - mu) / np.sqrt(var + EPS) * ln_g + ln_b
            h = relu(h) @ wt.T + bt
        vec = (h @ self.wmu.T + self.bmu)[..., :self.out_dims]
        bias = h @ self.wbias.T + self.bbias
        return vec, bias[..., 0]

    def forward(self, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return self.head(self.pre(x))


def stored_vector(who: np.ndarray, wbias: np.ndarray, look: np.ndarray,
                  lbias: np.ndarray) -> np.ndarray:
    """`value || key` as person.kv_vector holds it: [who, 1, wbias] then
    [look, lbias, 1]. Dotting `searcher_vector` of one person against
    `stored_vector` of another scores both directions of the pair at once."""
    ones = np.ones(who.shape[:-1] + (1,), np.float32)
    return np.concatenate(
        [who, ones, wbias[..., None], look, lbias[..., None], ones], -1)


def searcher_vector(stored: np.ndarray) -> np.ndarray:
    """`key || value`: a person's `stored_vector` with its halves the other
    way round, which is how they query everyone else's."""
    return np.concatenate([stored[HALF_DIMS:], stored[:HALF_DIMS]])
