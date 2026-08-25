import os
import sys

import pandas as pd
import psycopg
import pyarrow as pa
import pyarrow.parquet as pq

from kvmatching.pairs import SPLIT
from kvmatching.paths import DATA, ensure_dirs

DSN = os.environ.get(
    "DUO_DB_DSN",
    "host=localhost port=5432 dbname=duo_api user=postgres password=password")
SQL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sql")

NAMES = [
    "people", "prefs", "pref_answers", "messaged", "skipped",
    "questions", "answers", "dir_msgs",
]


def read_sql(name: str) -> str:
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
