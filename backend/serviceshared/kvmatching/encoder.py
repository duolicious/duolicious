"""Pure-numpy inference for the trained key-value encoders. No torch: the
weights are a frozen artifact shipped with a deployment, so serving only ever
runs this forward pass.

Each encoder is Linear -> (LayerNorm -> ReLU -> Linear) x N -> (vector head,
bias head); the artifact carries however many tail layers training used. The
first Linear's output is the only part whose cost scales with the number of
features a person has, so it is cached per person as `pre`: one changed
answer updates it with a single column add, and the rest of the forward pass
is a fixed-size tail.
"""
import numpy as np

EPS = 1e-5

# The first-layer weights ship as int16 multiples of this quantum rather than
# float16. Sums of them then stay on a grid that float32 represents exactly
# (any multiple below 2**24 * W0_QUANTUM = 2048), which is what lets the
# serving side patch a person's cached first-layer sums one column at a time
# without ever accumulating rounding error.
W0_QUANTUM = 2.0 ** -13


def relu(x: np.ndarray) -> np.ndarray:
    return np.maximum(x, 0.0)


class Encoder:
    def __init__(self, w: dict, prefix: str, out_dims: int):
        # stored float16, used float32: numpy has no fast float16 matmul
        g = lambda n: w[f'{prefix}.{n}'].astype(np.float32)
        self.w0 = g('w0') * W0_QUANTUM
        self.b0 = g('b0')
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
        """First-layer preactivation: the part that scales with the input."""
        return x @ self.w0.T + self.b0

    def pre_delta(self, pre: np.ndarray, column: int, delta: float) -> np.ndarray:
        """Apply a single changed input coordinate in O(hidden)."""
        return pre + self.w0[:, column] * delta

    def head(self, pre: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Fixed-size tail: returns (vector, bias scalar)."""
        h = pre
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
