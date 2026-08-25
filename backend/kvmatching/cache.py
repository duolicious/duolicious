import glob
import os
import pickle

from features import Features
from paths import DATA
from evaluate import EvalData
from pairs import SPLIT


def is_fresh(path: str) -> bool:
    """A cache is stale as soon as any extracted parquet is newer than it, so
    that re-running extract.py cannot leave training on old features."""
    if not os.path.exists(path):
        return False
    newest = max(os.path.getmtime(p) for p in glob.glob(os.path.join(DATA, "*.parquet")))
    return os.path.getmtime(path) >= newest


def load_features() -> Features:
    path = os.path.join(DATA, "features.pkl")
    if is_fresh(path):
        with open(path, "rb") as fh:
            return pickle.load(fh)
    f = Features()
    with open(path, "wb") as fh:
        pickle.dump(f, fh, protocol=5)
    return f


def load_evaldata(f: Features) -> EvalData:
    path = os.path.join(DATA, f"evaldata_{SPLIT.date()}.pkl")
    if is_fresh(path):
        with open(path, "rb") as fh:
            ed = pickle.load(fh)
        ed.f = f
        return ed
    ed = EvalData(f)
    with open(path, "wb") as fh:
        pickle.dump(ed, fh, protocol=5)
    return ed
