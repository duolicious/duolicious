"""Pure-numpy inference for the trained key-value encoders. No torch: the
weights are a frozen artifact shipped with a deployment, so serving only ever
runs this forward pass.

Each encoder is Linear -> LayerNorm -> ReLU -> Linear -> (vector head, bias
head). The first Linear's output is the only part whose cost scales with the
number of features a person has, so it is cached per person as `pre`: one
changed answer updates it with a single column add, and the rest of the
forward pass is a fixed-size 512-dim tail.
"""
import numpy as np

EPS = 1e-5


def relu(x: np.ndarray) -> np.ndarray:
    return np.maximum(x, 0.0)


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
        h = relu(h) @ self.w1.T + self.b1
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
        """[who, 1, wbias] -- dotted against another person's key."""
        ones = np.ones(who_vec.shape[:-1] + (1,), np.float32)
        return np.concatenate([who_vec, ones, wbias[..., None]], -1)

    def key_vector(self, look_vec: np.ndarray, lbias: np.ndarray) -> np.ndarray:
        """[look, lbias, 1] -- dotted against another person's value."""
        ones = np.ones(look_vec.shape[:-1] + (1,), np.float32)
        return np.concatenate([look_vec, lbias[..., None], ones], -1)

    def stored_vector(self, who_vec, wbias, look_vec, lbias) -> np.ndarray:
        """`value || key`, as person.kv_vector holds it. One inner product
        against another person's `key || value` is the mutual score."""
        return np.concatenate([self.value_vector(who_vec, wbias),
                               self.key_vector(look_vec, lbias)], -1)

    def searcher_vector(self, who_vec, wbias, look_vec, lbias) -> np.ndarray:
        """`key || value`: the same two halves the other way round."""
        return np.concatenate([self.key_vector(look_vec, lbias),
                               self.value_vector(who_vec, wbias)], -1)
