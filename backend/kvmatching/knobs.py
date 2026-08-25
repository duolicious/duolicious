"""Serving-time knobs on top of a trained run: an inbound-load penalty and a
values-agreement term. Both fold into one inner product by appending dims."""
import argparse
import json
import os
import sys
import numpy as np
import pandas as pd
import torch

from cache import load_features, load_evaldata
from evaluate import (Scorer, quick_metrics, retrieval_metrics, exposure_metrics,
                      agreement_probe, POLITICAL_QIDS, SEX_QIDS, normalize)
from pairs import load_interactions, SPLIT
from paths import DATA, run_dir
from train import scorer_from

VALUES_QIDS = POLITICAL_QIDS + SEX_QIDS + [213, 1131, 739, 931, 1665, 132, 48]


def recent_inbound(f, days: int) -> np.ndarray:
    m = pd.read_parquet(os.path.join(DATA, "messaged.parquet"))
    m = m[(m.created_at < SPLIT) & (m.created_at >= SPLIT - pd.Timedelta(days=days))]
    rows = f.pid2row.reindex(m.object_person_id).to_numpy()
    rows = rows[~np.isnan(rows)].astype(int)
    return np.bincount(rows, minlength=f.n).astype(np.float32)


def values_vectors(f) -> np.ndarray:
    cols = [int(np.flatnonzero(f.qids == q)[0]) for q in VALUES_QIDS]
    v = f.answers[:, cols].astype(np.float32)
    return normalize(v)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("run", help="run name under KV_WORK_DIR/runs")
    p.add_argument("--lams", default="0,0.5,1,2,4")
    p.add_argument("--gams", default="0,0.5,1,2")
    p.add_argument("--days", type=int, default=30)
    a = p.parse_args()
    a.run = run_dir(a.run)
    device = torch.device("cuda")
    f = load_features()
    ed = load_evaldata(f)
    who = np.load(os.path.join(a.run, "who.npy"))
    look = np.load(os.path.join(a.run, "look.npy"))
    wb = os.path.join(a.run, "wbias.npy")
    wbias = np.load(wb) if os.path.exists(wb) else np.zeros(f.n, np.float32)
    lb = os.path.join(a.run, "lbias.npy")
    lbias = np.load(lb) if os.path.exists(lb) else np.zeros(f.n, np.float32)
    base = scorer_from(who, look, wbias, lbias, device)
    L = base.look.cpu().numpy()
    W = base.who.cpu().numpy()
    rng = np.random.default_rng(0)
    ra = rng.choice(ed.exposure_pool, 20000)
    rb = rng.choice(ed.exposure_pool, 20000)
    sd = float(np.std((L[ra] * W[rb]).sum(1)))
    print("score sd over random pairs", sd, file=sys.stderr)

    load = np.log1p(recent_inbound(f, a.days))
    load = load / max(load[ed.exposure_pool].std(), 1e-6)
    V = values_vectors(f)
    ones = np.ones((f.n, 1), np.float32)
    rows = []
    for lam in [float(x) for x in a.lams.split(",")]:
        for gam in [float(x) for x in a.gams.split(",")]:
            L2 = np.concatenate([L, ones, gam * sd * V], 1)
            W2 = np.concatenate([W, (-lam * sd * load)[:, None], V], 1)
            sc = Scorer(L2, W2, device)
            r = {"lam": lam, "gam": gam}
            r.update(quick_metrics(sc, ed))
            r.update(retrieval_metrics(sc, ed))
            r.update(exposure_metrics(sc, ed))
            r.update(agreement_probe(sc, ed))
            rows.append(r)
            print(json.dumps(r), flush=True)
    df = pd.DataFrame(rows)
    cols = ["lam", "gam", "dir_auc", "inbox_auc_b2a", "reply_auc_b2a", "recall@10_recip",
            "recall@50_recip", "exposure_gini", "exposure_top1pct_share", "exposure_zero_frac",
            "political_disagree_top", "sex_disagree_top"]
    pd.set_option("display.width", 250)
    print(df[cols].round(3).to_string(index=False))
    df.to_csv(os.path.join(a.run, "knobs.csv"), index=False)


if __name__ == "__main__":
    main()
