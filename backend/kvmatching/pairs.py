import os
import numpy as np
import pandas as pd

from paths import DATA

if "KV_SPLIT" not in os.environ:
    raise SystemExit(
        "Set KV_SPLIT to the train/test split date, e.g. KV_SPLIT=2026-05-01. "
        "Use the same value for every command, extraction included.")
SPLIT = pd.Timestamp(os.environ["KV_SPLIT"])


def load_interactions() -> pd.DataFrame:
    """One row per directed (subject, object) pair with columns
    messaged_at, skipped_at, reported (NaT/False where absent)."""
    m = pd.read_parquet(os.path.join(DATA, "messaged.parquet"))
    s = pd.read_parquet(os.path.join(DATA, "skipped.parquet"))
    m = m.rename(columns={"created_at": "messaged_at"})
    s = s.rename(columns={"created_at": "skipped_at"})
    key = ["subject_person_id", "object_person_id"]
    df = m.merge(s, on=key, how="outer")
    df["reported"] = df["reported"].fillna(False).astype(bool)
    return df


def directed_labels(df: pd.DataFrame) -> pd.DataFrame:
    """label +1 if the subject messaged the object and never skipped them,
    -1 if they skipped them (a skip after a message counts as a skip: the
    subject's final judgement), with `t` the time of the deciding action."""
    skipped = df["skipped_at"].notna()
    messaged = df["messaged_at"].notna()
    label = np.where(skipped, -1, np.where(messaged, 1, 0)).astype(np.int8)
    t = df["skipped_at"].where(skipped, df["messaged_at"])
    out = pd.DataFrame({
        "a": df["subject_person_id"].to_numpy(),
        "b": df["object_person_id"].to_numpy(),
        "label": label,
        "t": t,
        "reported": df["reported"].to_numpy(),
        "messaged_at": df["messaged_at"],
        "skipped_at": df["skipped_at"],
    })
    return out


def replies(df: pd.DataFrame) -> pd.DataFrame:
    """For each first message a->b: whether b later messaged a back, and
    whether b skipped a."""
    m = df[df["messaged_at"].notna()][
        ["subject_person_id", "object_person_id", "messaged_at"]]
    rev = m.rename(columns={
        "subject_person_id": "object_person_id",
        "object_person_id": "subject_person_id",
        "messaged_at": "reply_at",
    })
    out = m.merge(rev, on=["subject_person_id", "object_person_id"], how="left")
    out["replied"] = out["reply_at"].notna() & (out["reply_at"] > out["messaged_at"])
    out["initiated"] = out["reply_at"].isna() | (out["reply_at"] > out["messaged_at"])
    s = df[df["skipped_at"].notna()][
        ["subject_person_id", "object_person_id", "skipped_at"]]
    srev = s.rename(columns={
        "subject_person_id": "object_person_id",
        "object_person_id": "subject_person_id",
        "skipped_at": "skipped_back_at",
    })
    out = out.merge(srev, on=["subject_person_id", "object_person_id"], how="left")
    out["skipped_back"] = out["skipped_back_at"].notna()
    return out


if __name__ == "__main__":
    df = load_interactions()
    lab = directed_labels(df)
    both = df["messaged_at"].notna() & df["skipped_at"].notna()
    print("pairs", len(df), "messaged", df["messaged_at"].notna().sum(),
          "skipped", df["skipped_at"].notna().sum(), "both", both.sum(),
          "skip-after-msg", (both & (df["skipped_at"] > df["messaged_at"])).sum())
    train = lab[lab["t"] < SPLIT]
    test = lab[lab["t"] >= SPLIT]
    print("train", len(train), (train.label == 1).sum(), (train.label == -1).sum())
    print("test", len(test), (test.label == 1).sum(), (test.label == -1).sum())
    r = replies(df)
    ri = r[r["initiated"]]
    print("first messages", len(ri), "replied", ri["replied"].mean(),
          "skipped_back", ri["skipped_back"].mean())
    rt = ri[ri["messaged_at"] >= SPLIT]
    print("test first messages", len(rt), "replied", rt["replied"].mean())
