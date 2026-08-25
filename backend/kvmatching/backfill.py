"""Write a trained run's vectors into person.kv_key / person.kv_value.

Run once after deploying new model weights. Vectors for people whose profile
changes afterwards are recomputed by the application, not here.

  KV_SPLIT=... python backfill.py model
"""
import sys
import numpy as np
import psycopg

from cache import load_features
from extract import DSN
from paths import run_dir

BATCH = 5000


def main() -> None:
    run = run_dir(sys.argv[1])
    f = load_features()
    who = np.load(f'{run}/who.npy')
    look = np.load(f'{run}/look.npy')
    wbias = np.load(f'{run}/wbias.npy')
    lbias = np.load(f'{run}/lbias.npy')
    assert len(who) == f.n == len(f.ids)

    ones = np.ones((f.n, 1), np.float32)
    value = np.concatenate([who, ones, wbias[:, None]], 1)
    key = np.concatenate([look, lbias[:, None], ones], 1)
    stored = np.concatenate([value, key], 1).astype(np.float32)
    print(f'{f.n} people, stored vector {stored.shape[1]} dims', flush=True)

    written = 0
    with psycopg.connect(DSN) as conn:
        for start in range(0, f.n, BATCH):
            sl = slice(start, min(start + BATCH, f.n))
            rows = [
                ('[' + ','.join(map(repr, x.tolist())) + ']', int(i))
                for i, x in zip(f.ids[sl], stored[sl])
            ]
            with conn.cursor() as cur:
                cur.executemany(
                    'UPDATE person SET kv_vector = %s::halfvec WHERE id = %s', rows)
            conn.commit()
            written += len(rows)
            print(f'  {written}/{f.n}', end='\r', flush=True)
    print(f'\nwrote {written} rows')


if __name__ == '__main__':
    main()
