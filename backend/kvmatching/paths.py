"""Where the pipeline reads and writes: never inside the repository, because
everything derived from the database is per-user data. Override the /tmp
default with KV_WORK_DIR to keep a run somewhere roomier or longer-lived.
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
