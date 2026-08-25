"""Freeze a trained run into a single artifact for serving: encoder weights
plus the feature vocabulary they were trained against. The vocabulary is
closed (a fixed question set and fixed enums), so it only changes when a new
model is deployed. Verifies the numpy encoder reproduces training's vectors
before writing.

  KV_SPLIT=... python export.py model [out.npz]
"""
import os
import sys
import numpy as np
import torch

from cache import load_features
from kvencoder import KVEncoder
from paths import WORK, run_dir
from features import N_COUNTRIES, N_CLUBS, LOC_FREQS, CAT_FIELDS, PREF_MULTI, PREF_TWO_WAY


def encoder_weights(sd: dict, prefix: str) -> dict:
    g = lambda n: sd[f'{prefix}.{n}'].numpy().astype(np.float32)
    return {
        f'{prefix}.w0': g('enc.net.0.weight'), f'{prefix}.b0': g('enc.net.0.bias'),
        f'{prefix}.ln_g': g('enc.net.1.weight'), f'{prefix}.ln_b': g('enc.net.1.bias'),
        f'{prefix}.w1': g('enc.net.4.weight'), f'{prefix}.b1': g('enc.net.4.bias'),
        f'{prefix}.wmu': g('mu.weight'), f'{prefix}.bmu': g('mu.bias'),
        f'{prefix}.wbias': g('bias.weight'), f'{prefix}.bbias': g('bias.bias'),
    }


def who_input(f, rows: np.ndarray) -> np.ndarray:
    cat = np.concatenate(
        [np.eye(s, dtype=np.float32)[f.cat[rows, i]] for i, s in enumerate(f.cat_sizes)], 1)
    return np.concatenate([
        f.answers[rows].astype(np.float32),
        cat,
        f.num[rows] * f.num_mask[rows], f.num_mask[rows],
        f.loc[rows],
        np.eye(N_COUNTRIES, dtype=np.float32)[f.country[rows]],
        f.clubs[rows].astype(np.float32),
    ], 1)


def look_input(f, rows: np.ndarray) -> np.ndarray:
    return np.concatenate([
        who_input(f, rows),
        f.pref_answers[rows].astype(np.float32),
        np.concatenate([b[rows].astype(np.float32) for b in f.pref_multi], 1),
        f.pref_num[rows] * f.pref_num_mask[rows], f.pref_num_mask[rows],
        f.pref_two_way[rows],
    ], 1)


def main() -> None:
    run = run_dir(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(WORK, 'kv_model.npz')
    f = load_features()
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
        'clubs': np.array(f.club_names),
        'pref_multi_fields': np.array(PREF_MULTI),
        'pref_multi_sizes': np.array(f.pref_multi_sizes, np.int64),
        'pref_two_way_fields': np.array(PREF_TWO_WAY + ['has_club_filter']),
        'loc_freqs': np.array(LOC_FREQS, np.int64),
    }
    np.savez_compressed(out, **art)

    enc = KVEncoder(out)
    rows = np.random.default_rng(0).choice(f.n, 256, replace=False)
    who_v, wb = enc.who.forward(who_input(f, rows))
    look_v, lb = enc.look.forward(look_input(f, rows))
    ref = {n: np.load(f'{run}/{n}.npy') for n in ['who', 'look', 'wbias', 'lbias']}
    for name, got, want in [('who', who_v, ref['who'][rows]), ('look', look_v, ref['look'][rows]),
                            ('wbias', wb, ref['wbias'][rows]), ('lbias', lb, ref['lbias'][rows])]:
        err = float(np.abs(got - want).max())
        print(f'{name:<6} max abs error vs training output: {err:.3e}')
        assert err < 1e-3, f'{name} does not reproduce training output'

    pre = enc.who.pre(who_input(f, rows[:1]))
    col = int(np.flatnonzero(f.answers[rows[0]] != 0)[0])
    flipped = who_input(f, rows[:1]).copy()
    delta = -2.0 * flipped[0, col]
    flipped[0, col] += delta
    incr = enc.who.head(enc.who.pre_delta(pre, col, delta))[0]
    full = enc.who.forward(flipped)[0]
    print(f'incremental update matches full recompute: {float(np.abs(incr - full).max()):.3e}')
    assert np.abs(incr - full).max() < 1e-4

    print(f'wrote {out} ({os.path.getsize(out) / 1e6:.1f} MB)')


if __name__ == '__main__':
    main()
