"""Check the backend's feature builder agrees with training's.

The encoders were fitted against the layout in features.py; if the serving
path puts a column anywhere else the vectors are quietly wrong rather than
missing. Run against a database copy after changing either side.

  KV_SPLIT=... python -m kvmatching.verify_serving [n_people] [run]
"""
import os
import sys

import numpy as np
import psycopg

from kvmatching.cache import load_features
from kvmatching.export import look_input as train_look, who_input as train_who
from kvmatching.extract import DSN
from kvmatching.paths import WORK

from serviceshared.kvmatching import features as serving_features
from serviceshared.kvmatching import rows as serving_rows
from serviceshared.kvmatching.spec import Spec
from serviceshared.kvmatching.sql import (
    Q_ANSWERS, Q_PERSON_ROWS, Q_PREF_ANSWERS)


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    run = sys.argv[2] if len(sys.argv) > 2 else 'model'
    f = load_features()
    spec = Spec(os.path.join(WORK, 'kv_model.npz'))
    rng = np.random.default_rng(0)
    sample = np.sort(rng.choice(f.n, n, replace=False))
    ids = [int(x) for x in f.ids[sample]]

    with psycopg.connect(DSN, row_factory=psycopg.rows.dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(Q_PERSON_ROWS, {'person_ids': ids})
            people = cur.fetchall()
        with conn.cursor() as cur:
            cur.execute(Q_ANSWERS, {'person_ids': ids})
            answers = [(r['person_id'], r['question_id'], r['answer']) for r in cur.fetchall()]
        with conn.cursor() as cur:
            cur.execute(Q_PREF_ANSWERS, {'person_ids': ids})
            prefs = [(r['person_id'], r['question_id'], r['answer']) for r in cur.fetchall()]

    built = serving_rows.build(spec, people, answers, prefs)
    got_ids = built.person_ids
    order = np.array([int(np.flatnonzero(f.ids == i)[0]) for i in got_ids])

    for name, serving, training in [
        ('who', serving_features.who_input(spec, built), train_who(f, order)),
        ('look', serving_features.look_input(spec, built), train_look(f, order)),
    ]:
        assert serving.shape == training.shape, f'{name}: {serving.shape} vs {training.shape}'
        delta = np.abs(serving - training)
        bad = np.flatnonzero(delta.max(0) > 1e-5)
        print(f'{name:<5} {serving.shape[1]} columns, max abs difference {delta.max():.2e}, '
              f'{len(bad)} columns disagree')
        if len(bad):
            print(f'      first disagreeing columns: {bad[:12].tolist()}')
        assert not len(bad), f'{name} features disagree with training'

    vec_s, bias_s = spec.who.forward(serving_features.who_input(spec, built))
    who = np.load(os.path.join(WORK, 'runs', run, 'who.npy'))[order]
    print(f'\nresulting who vectors match training output to '
          f'{np.abs(vec_s - who).max():.2e}')
    print(f'{len(people)} people checked -- serving and training agree')


if __name__ == '__main__':
    main()
