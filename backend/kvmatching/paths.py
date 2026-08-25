"""Where the pipeline reads and writes.

Everything derived from the database -- extracted parquet, feature caches,
trained vectors -- is per-user data, so none of it is written inside the
repository. The default lives under /tmp; override with KV_WORK_DIR to keep
it somewhere with more room or a longer life.
"""
import os

WORK = os.environ.get("KV_WORK_DIR", "/tmp/duolicious-kvmatching")
DATA = os.path.join(WORK, "data")
RUNS = os.path.join(WORK, "runs")


def run_dir(name: str) -> str:
    """Resolve a run name (not a path) under the work directory."""
    return os.path.join(RUNS, name)


def ensure_dirs() -> None:
    os.makedirs(DATA, exist_ok=True)
    os.makedirs(RUNS, exist_ok=True)
