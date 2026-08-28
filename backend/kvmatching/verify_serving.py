"""Check the rows the backend reads a person from agree with training's.

Both sides build their features with the same code, so what is left to get
wrong is the reading, where a column from the wrong place is quietly wrong
rather than missing. Rebuilds a sample of people from the live tables and
from the extracted parquet and compares the two, column for column.

  KV_SPLIT=... python -m kvmatching.verify_serving [n_people] [run]
"""
import os
import sys

import numpy as np
import psycopg

from kvmatching.extract import DSN
from kvmatching.features import Features
from kvmatching.paths import WORK

from serviceshared.kvmatching import rows as serving_rows
from serviceshared.kvmatching.features import look_input, who_input
from serviceshared.kvmatching.spec import Spec
from serviceshared.kvmatching.sql import (
    answers_query, beh_counts_query, person_rows_query, pref_answers_query)
from kvmatching.extract import BEH_PARAMS


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    run = sys.argv[2] if len(sys.argv) > 2 else 'model'
    f = Features()
    spec = Spec(os.path.join(WORK, 'kv_model.npz'))
    rng = np.random.default_rng(0)
    sample = np.sort(rng.choice(f.n, n, replace=False))
    ids = [int(x) for x in f.ids[sample]]

    people = []
    answers: list[tuple[int, int, bool]] = []
    prefs: list[tuple[int, int, bool]] = []
    with psycopg.connect(DSN, row_factory=psycopg.rows.dict_row) as conn:
        with conn.cursor() as cur:
            for person_id in ids:
                params = {'person_id': person_id}
                cur.execute(person_rows_query(everyone=False), params)
                people.extend(cur.fetchall())
                cur.execute(answers_query(everyone=False), params)
                answers.extend(
                    (r['person_id'], r['question_id'], r['answer'])
                    for r in cur.fetchall())
                cur.execute(pref_answers_query(everyone=False), params)
                prefs.extend(
                    (r['person_id'], r['question_id'], r['answer'])
                    for r in cur.fetchall())
        # In production the person row carries the behaviour counters; here
        # they are recomputed from the event tables at the SPLIT cutoff, so
        # both sides of the comparison see the same events regardless of
        # whether this database copy has the counter columns yet.
        with conn.cursor() as cur:
            cur.execute(beh_counts_query(everyone=False),
                        {**BEH_PARAMS, 'person_ids': ids})
            counts = {r['person_id']: r for r in cur.fetchall()}

    people = [{**p, **counts[p['id']]} for p in people]

    built = serving_rows.build(spec, people, answers, prefs)
    got_ids = built.person_ids
    order = np.array([int(np.flatnonzero(f.ids == i)[0]) for i in got_ids])
    extracted = f.blocks(order)

    for name, live, offline in [
        ('who', who_input(spec, built), who_input(spec, extracted)),
        ('look', look_input(spec, built), look_input(spec, extracted)),
    ]:
        assert live.shape == offline.shape, f'{name}: {live.shape} vs {offline.shape}'
        delta = np.abs(live - offline)
        bad = np.flatnonzero(delta.max(0) > 1e-5)
        print(f'{name:<5} {live.shape[1]} columns, max abs difference {delta.max():.2e}, '
              f'{len(bad)} columns disagree')
        if len(bad):
            print(f'      first disagreeing columns: {bad[:12].tolist()}')
        assert not len(bad), f'{name} features disagree with training'

    vec_s, bias_s = spec.who.forward(who_input(spec, built))
    who = np.load(os.path.join(WORK, 'runs', run, 'who.npy'))[order]
    print(f'\nresulting who vectors match training output to '
          f'{np.abs(vec_s - who).max():.2e}')
    print(f'{len(people)} people checked -- serving and training agree')


if __name__ == '__main__':
    main()
