import glob
import os
import pickle
from collections.abc import Callable
from typing import TypeVar

from kvmatching import features as train_features
from kvmatching.evaluate import EvalData
from kvmatching.features import Features
from kvmatching.pairs import SPLIT
from kvmatching.paths import DATA
from serviceshared.kvmatching import features as serving_features

T = TypeVar("T")
SOURCES = [train_features.__file__, serving_features.__file__]


def is_fresh(path: str) -> bool:
    """A cache is stale as soon as any extracted parquet, or either of the
    files that turn one into features, is newer than it: neither re-running
    extract.py nor editing a feature can leave training on old features."""
    if not os.path.exists(path):
        return False
    inputs = glob.glob(os.path.join(DATA, "*.parquet")) + SOURCES
    return os.path.getmtime(path) >= max(os.path.getmtime(p) for p in inputs)


def _cached(path: str, build: Callable[[], T]) -> T:
    if is_fresh(path):
        with open(path, "rb") as fh:
            value: T = pickle.load(fh)
            return value
    value = build()
    with open(path, "wb") as fh:
        pickle.dump(value, fh, protocol=5)
    return value


def load_features() -> Features:
    return _cached(os.path.join(DATA, "features.pkl"), Features)


def load_evaldata(f: Features) -> EvalData:
    ed = _cached(os.path.join(DATA, f"evaldata_{SPLIT.date()}.pkl"),
                 lambda: EvalData(f))
    ed.f = f
    return ed
