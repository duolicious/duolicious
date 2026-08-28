import os
import sys

import pandas as pd
import psycopg
import pyarrow as pa
import pyarrow.parquet as pq

from kvmatching.pairs import SPLIT
from kvmatching.paths import DATA, ensure_dirs
from serviceshared.kvmatching.sql import beh_counts_query

DSN = os.environ.get(
    "DUO_DB_DSN",
    "host=localhost port=5432 dbname=duo_api user=postgres password=password")
SQL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sql")

NAMES = [
    "people", "prefs", "pref_answers", "messaged", "skipped",
    "questions", "answers", "dir_msgs", "beh_counts", "bio",
]

# The behaviour counters use the serving side's own query so that training
# sees exactly what the chat path will maintain, restricted to before SPLIT.
# The mam cutoff is the id whose embedded timestamp is the split instant.
BEH_PARAMS = {
    "cutoff": SPLIT.to_pydatetime(),
    "cutoff_mid": int(SPLIT.timestamp() * 1e6) << 8,
}


def read_sql(name: str) -> str:
    if name == "beh_counts":
        return beh_counts_query(everyone=True)
    with open(os.path.join(SQL_DIR, f"{name}.sql")) as fh:
        return fh.read()


def build_scratch(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        for statement in read_sql("msg").split(";"):
            if statement.strip():
                cur.execute(statement)
    conn.commit()
    print("scratch_kv.msg built", file=sys.stderr)


def extract(conn: psycopg.Connection, name: str) -> None:
    out = os.path.join(DATA, f"{name}.parquet")
    params = {"split": SPLIT.to_pydatetime()} if name == "dir_msgs" else None
    if name == "beh_counts":
        params = BEH_PARAMS
    with conn.cursor() as cur:
        cur.execute(read_sql(name), params)
        assert cur.description is not None
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    df = pd.DataFrame.from_records(rows, columns=cols)
    pq.write_table(pa.Table.from_pandas(df, preserve_index=False), out)
    print(name, len(df), file=sys.stderr)


def main() -> None:
    ensure_dirs()
    names = sys.argv[1:] or NAMES
    with psycopg.connect(DSN) as conn:
        if "dir_msgs" in names:
            build_scratch(conn)
        for name in names:
            extract(conn, name)


if __name__ == "__main__":
    main()
