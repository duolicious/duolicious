"""The observational benchmark the PR descriptions quote: of the held-out
first messages, rank the messaged pairs by each scorer's mutual score and
report how often the top decile got a reply or reached a 20-message-each-way
conversation, against the all-messages baseline. Conditioned on pairs who
already messaged under the current ranking, so it under-credits retrieval
changes; an A/B test settles magnitudes.

  KV_SPLIT=... python -m kvmatching.bench model
"""
import os
import sys

import numpy as np
import pandas as pd
import psycopg

from kvmatching.cache import load_features
from kvmatching.extract import DSN
from kvmatching.features import Features
from kvmatching.pairs import SPLIT, load_interactions, replies
from kvmatching.paths import DATA, run_dir
from serviceshared.kvmatching.blocks import FloatArray, IntArray


def mutual_scores(run: str, a: IntArray, b: IntArray) -> FloatArray:
    d = run_dir(run)
    who = np.load(f'{d}/who.npy')
    look = np.load(f'{d}/look.npy')
    wbias = np.load(f'{d}/wbias.npy')
    lbias = np.load(f'{d}/lbias.npy')
    return ((look[a] * who[b]).sum(1) + lbias[a] + wbias[b]
            + (look[b] * who[a]).sum(1) + lbias[b] + wbias[a])


def club_vectors(f: Features) -> FloatArray:
    out = np.zeros((f.n, 64), np.float32)
    with psycopg.connect(DSN) as conn, conn.cursor() as cur:
        cur.execute('SELECT id, club_vector::TEXT FROM person')
        for pid, text in cur:
            row = f.pid2row.get(pid)
            if row is not None and text is not None:
                out[int(row)] = np.fromstring(text[1:-1], sep=',')
    return out


def report(label: str, scores: FloatArray, replied: FloatArray,
           deep: FloatArray) -> None:
    top = np.argpartition(-scores, len(scores) // 10 - 1)[:len(scores) // 10]
    print(f'{label:<18}'
          f'replied@10% {replied[top].mean():.3f} '
          f'({replied[top].mean() / replied.mean():.2f}x)   '
          f'20-each-way@10% {deep[top].mean():.3f} '
          f'({deep[top].mean() / deep.mean():.2f}x)')


def main() -> None:
    run = sys.argv[1] if len(sys.argv) > 1 else 'model'
    f = load_features()

    r = replies(load_interactions())
    r = r[r['messaged_at'] >= SPLIT]
    ra = f.pid2row.reindex(r['subject_person_id']).to_numpy()
    rb = f.pid2row.reindex(r['object_person_id']).to_numpy()
    ok = ~np.isnan(ra) & ~np.isnan(rb)
    r = r[ok]
    a = ra[ok].astype(int)
    b = rb[ok].astype(int)

    d = pd.read_parquet(os.path.join(DATA, 'dir_msgs.parquet'))
    d['ar'] = f.pid2row.reindex(d['subject_person_id']).to_numpy()
    d['br'] = f.pid2row.reindex(d['object_person_id']).to_numpy()
    d = d.dropna(subset=['ar', 'br'])
    n = {(int(x), int(y)): c for x, y, c in zip(d['ar'], d['br'], d['n'])}
    deep = np.array([
        n.get((x, y), 0) >= 20 and n.get((y, x), 0) >= 20
        for x, y in zip(a, b)
    ], np.float32)
    replied = r['reply_at'].notna().to_numpy().astype(np.float32)

    print(f'{len(r)} first messages after {SPLIT.date()}: '
          f'replied {replied.mean():.3f}, 20-each-way {deep.mean():.3f}')

    cv = club_vectors(f)
    scorers = [
        (run, mutual_scores(run, a, b)),
        ('similar clubs', (cv[a] * cv[b]).sum(1)),
        ('match percentage', (f.personality[a] * f.personality[b]).sum(1)),
    ]
    for label, scores in scorers:
        report(label, scores, replied, deep)

    both = (np.abs(cv[a]).sum(1) > 0) & (np.abs(cv[b]).sum(1) > 0)
    print(f'\nrestricted to the {both.mean():.0%} of pairs where both have '
          f'club vectors: replied {replied[both].mean():.3f}, '
          f'20-each-way {deep[both].mean():.3f}')
    for label, scores in scorers:
        report(label, scores[both], replied[both], deep[both])


if __name__ == '__main__':
    main()
