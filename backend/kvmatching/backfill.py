"""Write a trained run's vectors into person.kv_key / person.kv_value.

Run once after deploying new model weights. Vectors for people whose profile
changes afterwards are recomputed by the application, not here.

  KV_SPLIT=... python backfill.py runs/model
"""
import os
import sys
import numpy as np
import psycopg

from cache import load_features
from extract import DSN
from kvencoder import KVEncoder

BATCH = 5000


def main() -> None:
    run = sys.argv[1]
    f = load_features()
    enc = KVEncoder(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'kv_model.npz')) \
        if os.path.exists('kv_model.npz') else None
    who = np.load(f'{run}/who.npy')
    look = np.load(f'{run}/look.npy')
    wbias = np.load(f'{run}/wbias.npy')
    lbias = np.load(f'{run}/lbias.npy')
    assert len(who) == f.n == len(f.ids)

    ones = np.ones((f.n, 1), np.float32)
    key = np.concatenate([look, lbias[:, None], ones], 1).astype(np.float32)
    value = np.concatenate([who, ones, wbias[:, None]], 1).astype(np.float32)
    print(f'{f.n} people, key/value dims {key.shape[1]}/{value.shape[1]}', flush=True)

    written = 0
    with psycopg.connect(DSN) as conn:
        for start in range(0, f.n, BATCH):
            sl = slice(start, min(start + BATCH, f.n))
            rows = [
                (int(i), '[' + ','.join(map(repr, k.tolist())) + ']',
                 '[' + ','.join(map(repr, v.tolist())) + ']')
                for i, k, v in zip(f.ids[sl], key[sl], value[sl])
            ]
            with conn.cursor() as cur:
                cur.executemany(
                    'UPDATE person SET kv_key = %s::halfvec, kv_value = %s::halfvec '
                    'WHERE id = %s',
                    [(k, v, i) for i, k, v in rows])
            conn.commit()
            written += len(rows)
            print(f'  {written}/{f.n}', end='\r', flush=True)
    print(f'\nwrote {written} rows')


if __name__ == '__main__':
    main()
