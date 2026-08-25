"""Check the backend's feature builder agrees with training's.

The encoders were fitted against the layout in features.py; if the serving
path puts a column anywhere else the vectors are quietly wrong rather than
missing. Run against a database copy after changing either side.

  KV_SPLIT=... python verify_serving.py [n_people]
"""
import os
import sys

import importlib.util
import types

import numpy as np
import psycopg

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)


def _bare_package(name: str, path: str) -> None:
    """Register a namespace package without running its __init__, which for
    service.cron imports every cron job and everything they depend on."""
    mod = types.ModuleType(name)
    mod.__path__ = [path]
    sys.modules[name] = mod


_bare_package('service', os.path.join(BACKEND, 'service'))
_bare_package('service.cron', os.path.join(BACKEND, 'service', 'cron'))
_bare_package('service.cron.kvvectors',
              os.path.join(BACKEND, 'service', 'cron', 'kvvectors'))


def _load(name: str) -> types.ModuleType:
    full = f'service.cron.kvvectors.{name}'
    path = os.path.join(BACKEND, 'service', 'cron', 'kvvectors', f'{name}.py')
    spec_ = importlib.util.spec_from_file_location(full, path)
    assert spec_ and spec_.loader
    mod = importlib.util.module_from_spec(spec_)
    sys.modules[full] = mod
    spec_.loader.exec_module(mod)
    return mod


_load('encoder')
_load('spec')
_load('blocks')
_load('features')
_load('rows')
_sql_dir = os.path.join(BACKEND, 'service', 'cron', 'kvvectors', 'sql')
_bare_package('service.cron.kvvectors.sql', _sql_dir)
_spec_sql = importlib.util.spec_from_file_location(
    'service.cron.kvvectors.sql', os.path.join(_sql_dir, '__init__.py'))
assert _spec_sql and _spec_sql.loader
_sql_mod = importlib.util.module_from_spec(_spec_sql)
sys.modules['service.cron.kvvectors.sql'] = _sql_mod
_spec_sql.loader.exec_module(_sql_mod)

from cache import load_features
from export import who_input as train_who, look_input as train_look
from extract import DSN
from paths import WORK

from service.cron.kvvectors import rows as serving_rows
from service.cron.kvvectors import features as serving_features
from service.cron.kvvectors.spec import Spec
from service.cron.kvvectors.sql import (
    Q_ANSWERS, Q_CLUBS, Q_PERSON_ROWS, Q_PREF_ANSWERS)


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 200
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
        with conn.cursor() as cur:
            cur.execute(Q_CLUBS, {'person_ids': ids})
            clubs = [(r['person_id'], r['club_name']) for r in cur.fetchall()]

    built = serving_rows.build(spec, people, answers, prefs, clubs)
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
    who = np.load(os.path.join(WORK, 'runs', 'model', 'who.npy'))[order]
    print(f'\nresulting who vectors match training output to '
          f'{np.abs(vec_s - who).max():.2e}')
    print(f'{len(people)} people checked -- serving and training agree')


if __name__ == '__main__':
    main()
