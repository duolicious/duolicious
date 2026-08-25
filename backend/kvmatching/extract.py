import os
import sys
import psycopg
import pyarrow as pa
import pyarrow.parquet as pq
import pandas as pd

from pairs import SPLIT
from paths import DATA, ensure_dirs

DSN = os.environ.get(
    "DUO_DB_DSN",
    "host=localhost port=5432 dbname=duo_api user=postgres password=password")
HERE = os.path.dirname(os.path.abspath(__file__))

NAMES = [
    "people", "prefs", "pref_answers", "clubs", "messaged", "skipped",
    "questions", "answers", "dir_msgs",
]


def build_scratch(conn: psycopg.Connection) -> None:
    sql = open(os.path.join(HERE, "sql", "msg.sql")).read()
    with conn.cursor() as cur:
        for statement in sql.split(";"):
            if statement.strip():
                cur.execute(statement)
    conn.commit()
    print("scratch_kv.msg built", file=sys.stderr)


def extract(conn: psycopg.Connection, name: str) -> None:
    sql = open(os.path.join(HERE, "sql", f"{name}.sql")).read()
    out = os.path.join(DATA, f"{name}.parquet")
    params = {"split": SPLIT.to_pydatetime()} if name == "dir_msgs" else None
    with conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d.name for d in cur.description]
        rows = cur.fetchall()
    df = pd.DataFrame.from_records(rows, columns=cols)
    pq.write_table(pa.Table.from_pandas(df, preserve_index=False), out)
    print(name, len(df), file=sys.stderr)


if __name__ == "__main__":
    ensure_dirs()
    names = sys.argv[1:] or NAMES
    with psycopg.connect(DSN) as conn:
        if "dir_msgs" in names:
            build_scratch(conn)
        for n in names:
            extract(conn, n)
