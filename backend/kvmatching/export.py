"""Freeze a trained run into a single artifact for serving: encoder weights
plus the feature vocabulary they were trained against. The vocabulary is
closed (a fixed question set and fixed enums), so it only changes when a new
model is deployed. Verifies the numpy encoder reproduces training's vectors
before writing.

  KV_SPLIT=... python -m kvmatching.export model [out.npz]
"""
import os
import sys

import numpy as np
import numpy.typing as npt
import torch

from kvmatching.features import (
    CAT_FIELDS,
    Features,
    LOC_FREQS,
    N_COUNTRIES,
    PREF_MULTI,
    PREF_TWO_WAY,
)
from kvmatching.paths import WORK, run_dir
from serviceshared.kvmatching.encoder import W0_QUANTUM
from serviceshared.kvmatching.features import look_input, who_input
from serviceshared.kvmatching.spec import Spec


def encoder_weights(
        sd: dict[str, torch.Tensor], prefix: str,
) -> dict[str, npt.NDArray[np.float16] | npt.NDArray[np.int16]]:
    # The quantised weights shift the output vectors by at most ~1e-3, which
    # is the resolution person.kv_vector stores them at anyway, and halve a
    # file that ships with every deployment. The first layer is fixed-point
    # (int16 multiples of W0_QUANTUM) rather than float16 so that each
    # person's cached first-layer sums live on a grid float32 carries
    # exactly; the serving side can then patch them column by column with no
    # rounding error.
    def g(n: str) -> npt.NDArray[np.float16]:
        return sd[f'{prefix}.{n}'].numpy().astype(np.float16)

    w0 = np.round(sd[f'{prefix}.enc.net.0.weight'].numpy() / W0_QUANTUM)
    assert float(np.abs(w0).max()) < 2 ** 15, 'w0 overflows int16 at this quantum'

    out = {
        f'{prefix}.w0': w0.astype(np.int16), f'{prefix}.b0': g('enc.net.0.bias'),
        f'{prefix}.wmu': g('mu.weight'), f'{prefix}.bmu': g('mu.bias'),
        f'{prefix}.wbias': g('bias.weight'), f'{prefix}.bbias': g('bias.bias'),
    }
    # The encoder MLP interleaves Linear, LayerNorm, ReLU, Dropout, so tail
    # layer t's LayerNorm sits at net index 4t - 3 and its Linear at 4t.
    t = 1
    while f'{prefix}.enc.net.{4 * t}.weight' in sd:
        out[f'{prefix}.ln_g{t}'] = g(f'enc.net.{4 * t - 3}.weight')
        out[f'{prefix}.ln_b{t}'] = g(f'enc.net.{4 * t - 3}.bias')
        out[f'{prefix}.w{t}'] = g(f'enc.net.{4 * t}.weight')
        out[f'{prefix}.b{t}'] = g(f'enc.net.{4 * t}.bias')
        t += 1
    return out


def main() -> None:
    run = run_dir(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(WORK, 'kv_model.npz')
    f = Features()
    sd = torch.load(f'{run}/model.pt', map_location='cpu', weights_only=True)
    m = sd['who.mu.weight'].shape[0]

    countries = f.people['country'].fillna('')
    top_countries = list(countries.value_counts().index[:N_COUNTRIES - 1])

    art = {
        **encoder_weights(sd, 'who'),
        **encoder_weights(sd, 'look'),
        'm': np.int64(m),
        'qids': f.qids.astype(np.int64),
        'cat_fields': np.array(CAT_FIELDS),
        'cat_sizes': np.array(f.cat_sizes, np.int64),
        'countries': np.array(top_countries),
        'pref_multi_fields': np.array(PREF_MULTI),
        'pref_multi_sizes': np.array(f.pref_multi_sizes, np.int64),
        'pref_two_way_fields': np.array(PREF_TWO_WAY + ['has_club_filter']),
        'loc_freqs': np.array(LOC_FREQS, np.int64),
    }
    # Even if someone answered every question adversarially, the answer
    # blocks' first-layer sums stay below 2**24 grid steps, where float32
    # stops being exact and column-at-a-time patching would break.
    nq = len(f.qids)
    who_width = art['who.w0'].shape[1]
    worst = max(
        int(np.abs(art['who.w0'][:, :nq].astype(np.int64)).sum(1).max()),
        int(np.abs(art['look.w0'][:, :nq].astype(np.int64)).sum(1).max()
            + np.abs(art['look.w0'][:, who_width:who_width + nq]
                     .astype(np.int64)).sum(1).max()),
    )
    assert worst < 2 ** 24, f'answer-block sums can leave the exact grid ({worst})'

    np.savez_compressed(out, **art)

    enc = Spec(out)
    rows = np.random.default_rng(0).choice(f.n, 256, replace=False)
    b = f.blocks(rows)
    who_v, wb = enc.who.forward(who_input(enc, b))
    look_v, lb = enc.look.forward(look_input(enc, b))
    ref = {n: np.load(f'{run}/{n}.npy') for n in ['who', 'look', 'wbias', 'lbias']}
    for name, got, want in [('who', who_v, ref['who'][rows]), ('look', look_v, ref['look'][rows]),
                            ('wbias', wb, ref['wbias'][rows]), ('lbias', lb, ref['lbias'][rows])]:
        err = float(np.abs(got - want).max())
        print(f'{name:<6} max abs error vs training output: {err:.3e}')
        # float16 weights account for ~1e-3; anything beyond that is a bug
        # in the numpy encoder rather than quantisation.
        assert err < 3e-3, f'{name} does not reproduce training output'

    one = who_input(enc, f.blocks(rows[:1]))
    pre = enc.who.pre(one)
    col = int(np.flatnonzero(f.answers[rows[0]] != 0)[0])
    flipped = one.copy()
    delta = -2.0 * flipped[0, col]
    flipped[0, col] += delta
    incr = enc.who.head(enc.who.pre_delta(pre, col, delta))[0]
    full = enc.who.forward(flipped)[0]
    print(f'incremental update matches full recompute: {float(np.abs(incr - full).max()):.3e}')
    assert np.abs(incr - full).max() < 1e-4

    print(f'wrote {out} ({os.path.getsize(out) / 1e6:.1f} MB)')


if __name__ == '__main__':
    main()
