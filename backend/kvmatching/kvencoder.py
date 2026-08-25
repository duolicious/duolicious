"""Pure-numpy inference for the trained key-value encoders. No torch: the
weights are a frozen artifact shipped with a deployment, so serving only ever
runs this forward pass.

Each encoder is Linear -> LayerNorm -> GELU -> Linear -> (vector head, bias
head). The first Linear's output is the only part whose cost scales with the
number of features a person has, so it is cached per person as `pre`: one
changed answer updates it with a single column add, and the rest of the
forward pass is a fixed-size 512-dim tail.
"""
import numpy as np

EPS = 1e-5


_ERF_P = 0.3275911
_ERF_C = (0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429)


def _erf(x: np.ndarray) -> np.ndarray:
    """Abramowitz & Stegun 7.1.26, max error 1.5e-7 -- below float32 epsilon,
    and it keeps serving free of a scipy dependency."""
    sign = np.sign(x)
    t = 1.0 / (1.0 + _ERF_P * np.abs(x))
    poly = t * (_ERF_C[0] + t * (_ERF_C[1] + t * (_ERF_C[2] + t * (_ERF_C[3] + t * _ERF_C[4]))))
    return sign * (1.0 - poly * np.exp(-x * x))


def gelu(x: np.ndarray) -> np.ndarray:
    return 0.5 * x * (1.0 + _erf(x / np.sqrt(2.0)))


class Encoder:
    def __init__(self, w: dict, prefix: str, out_dims: int):
        g = lambda n: w[f'{prefix}.{n}']
        self.w0 = g('w0')
        self.b0 = g('b0')
        self.ln_g = g('ln_g')
        self.ln_b = g('ln_b')
        self.w1 = g('w1')
        self.b1 = g('b1')
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
        mu = pre.mean(-1, keepdims=True)
        var = pre.var(-1, keepdims=True)
        h = (pre - mu) / np.sqrt(var + EPS) * self.ln_g + self.ln_b
        h = gelu(h) @ self.w1.T + self.b1
        vec = (h @ self.wmu.T + self.bmu)[..., :self.out_dims]
        bias = h @ self.wbias.T + self.bbias
        return vec, bias[..., 0]

    def forward(self, x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        return self.head(self.pre(x))


class KVEncoder:
    def __init__(self, path: str):
        z = np.load(path, allow_pickle=False)
        w = {k: z[k] for k in z.files if '.' in k}
        self.m = int(z['m'])
        self.who = Encoder(w, 'who', self.m)
        self.look = Encoder(w, 'look', self.m)

    def value_vector(self, who_vec: np.ndarray, wbias: np.ndarray) -> np.ndarray:
        """[who, 1, wbias] -- the prospect side of the inner product."""
        ones = np.ones(who_vec.shape[:-1] + (1,), np.float32)
        return np.concatenate([who_vec, ones, wbias[..., None]], -1)

    def key_vector(self, look_vec: np.ndarray, lbias: np.ndarray) -> np.ndarray:
        """[look, lbias, 1] -- the searcher side of the inner product."""
        ones = np.ones(look_vec.shape[:-1] + (1,), np.float32)
        return np.concatenate([look_vec, lbias[..., None], ones], -1)
