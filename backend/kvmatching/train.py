import argparse
import json
import os
import time
from typing import TextIO

import numpy as np
import pandas as pd
import torch

from kvmatching.evaluate import (
    Scorer,
    agreement_probe,
    exposure_metrics,
    load_evaldata,
    prod_scorer,
    quick_metrics,
    retrieval_metrics,
)
from kvmatching.features import Features, TensorFeatures
from kvmatching.model import KVModel, Noise, kl, reparam
from kvmatching.pairs import SPLIT, directed_labels, load_interactions, replies
from kvmatching.paths import DATA, ensure_dirs, run_dir
from serviceshared.kvmatching.blocks import FloatArray
from serviceshared.kvmatching.encoder import LATENT_DIMS


M, N = LATENT_DIMS, 32
HIDDEN, LAYERS, DROPOUT = 1024, 4, 0.1
EPOCHS, BATCH, RECON_BATCH = 8, 2048, 1024
LR, WD, BETA = 1e-3, 1e-4, 1e-3
NEG_WEIGHT, SKIP_WEIGHT = 1.0, 1.0
NOISE = Noise(p_answer=0.3, p_cat=0.1, p_pref=0.1, p_year=0.1, p_beh=0.3,
              p_prof=0.3)


def parse() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--name", default="model", help="run name, written under KV_WORK_DIR/runs")
    p.add_argument("--seed", type=int, default=0)
    return p.parse_args()


def train_pairs(f: Features) -> pd.DataFrame:
    df = load_interactions()
    lab = directed_labels(df)
    lab = lab[lab["t"] < SPLIT]
    r = replies(df)
    r = r[r["initiated"]][["subject_person_id", "object_person_id", "replied"]]
    lab = lab.merge(
        r, left_on=["a", "b"], right_on=["subject_person_id", "object_person_id"],
        how="left")
    lab["replied"] = lab["replied"].fillna(False).astype(bool)
    ra = f.pid2row.reindex(lab["a"]).to_numpy()
    rb = f.pid2row.reindex(lab["b"]).to_numpy()
    ok = ~np.isnan(ra) & ~np.isnan(rb)
    return pd.DataFrame({
        "a": ra[ok].astype(np.int64),
        "b": rb[ok].astype(np.int64),
        "label": lab["label"].to_numpy()[ok].astype(np.float32),
        "replied": lab["replied"].to_numpy()[ok],
        "reported": lab["reported"].to_numpy()[ok],
    })


def level_targets(tp: pd.DataFrame, f: Features) -> FloatArray:
    """-2 reported, -1 skipped, log2(1 + messages sent before SPLIT) for
    messaged pairs, and an implicit 0 for the random off-diagonal pairs."""
    d = pd.read_parquet(os.path.join(DATA, "dir_msgs.parquet"))
    d["a"] = f.pid2row.reindex(d.subject_person_id).to_numpy()
    d["b"] = f.pid2row.reindex(d.object_person_id).to_numpy()
    d = d.dropna(subset=["a", "b"]).astype({"a": int, "b": int})
    m = tp.merge(d[["a", "b", "n_before"]], on=["a", "b"], how="left")
    n = m["n_before"].fillna(0).to_numpy()
    y = tp["label"].to_numpy().astype(np.float32).copy()
    y[(y < 0) & tp["reported"].to_numpy()] = -2
    pos = y > 0
    y[pos] = np.log2(1 + np.maximum(n[pos], 1))
    return y


def pair_loss(neg_weight: float, C: torch.Tensor, y: torch.Tensor,
              w: torch.Tensor) -> torch.Tensor:
    B = C.shape[0]
    eye = torch.eye(B, device=C.device, dtype=torch.bool)
    diag = C.diagonal()
    on = (w * (diag - y) ** 2).sum() / w.sum()
    off = (C[~eye] ** 2).mean()
    return on + neg_weight * off


def all_vectors(
        model: KVModel, tf: TensorFeatures, n: int, bs: int = 4096,
) -> tuple[FloatArray, FloatArray, FloatArray, FloatArray]:
    model.eval()
    who, look, wbias, lbias = [], [], [], []
    with torch.no_grad():
        for s in range(0, n, bs):
            idx = torch.arange(s, min(n, s + bs), device=tf.device)
            w, wb = model.who_vec(tf.who_batch(idx), False)
            l, lb = model.look_vec(tf.look_batch(idx), False)
            who.append(w.cpu()); wbias.append(wb.cpu())
            look.append(l.cpu()); lbias.append(lb.cpu())
    model.train()
    return (torch.cat(who).numpy(), torch.cat(look).numpy(),
            torch.cat(wbias).numpy(), torch.cat(lbias).numpy())


def scorer_from(who: FloatArray, look: FloatArray, wbias: FloatArray,
                lbias: FloatArray, device: torch.device) -> Scorer:
    """Append bias dims so that look'.who' = look.who + lbias + wbias. wbias
    is the prospect's popularity term, lbias the searcher's eagerness term."""
    ones = np.ones((len(who), 1), dtype=np.float32)
    look2 = np.concatenate([look, lbias[:, None], ones], axis=1)
    who2 = np.concatenate([who, ones, wbias[:, None]], axis=1)
    return Scorer(look2, who2, device)


def run(args: argparse.Namespace, out: str, log: TextIO) -> None:
    def say(*a: object) -> None:
        s = " ".join(str(x) for x in a)
        print(s, flush=True)
        log.write(s + "\n")
        log.flush()

    device = torch.device("cuda")
    say("args", json.dumps(vars(args)))
    f = Features()
    ed = load_evaldata(f)
    tf = TensorFeatures(f, device)
    tp = train_pairs(f)
    say("train pairs", len(tp), "pos", int((tp.label > 0).sum()),
        "neg", int((tp.label < 0).sum()))

    w = np.where(tp.label > 0, 1.0, SKIP_WEIGHT).astype(np.float32)
    y_np = level_targets(tp, f)
    say("level targets: mean", float(y_np.mean()), "positives mean", float(y_np[y_np > 0].mean()),
        "quartiles", np.percentile(y_np[y_np > 0], [25, 50, 75, 95]).round(2).tolist())
    A = torch.as_tensor(tp.a.to_numpy(), device=device)
    Bi = torch.as_tensor(tp.b.to_numpy(), device=device)
    Y = torch.as_tensor(y_np, device=device)
    W = torch.as_tensor(w, device=device)

    p = f.people
    eligible = np.flatnonzero((p["activated"] & ~p["is_bot"]).to_numpy())
    ELIG = torch.as_tensor(eligible, device=device)

    model = KVModel(tf, M, N, HIDDEN, LAYERS, NOISE, DROPOUT).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=WD)
    steps_per_epoch = len(tp) // BATCH
    total = steps_per_epoch * EPOCHS
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=LR, total_steps=total, pct_start=0.05)

    prod = prod_scorer(f, device)
    say("prod", json.dumps(quick_metrics(prod, ed)))

    step = 0
    t0 = time.time()
    for epoch in range(EPOCHS):
        perm = torch.randperm(len(tp), device=device)
        acc: dict[str, float] = {}
        for i in range(steps_per_epoch):
            idx = perm[i * BATCH:(i + 1) * BATCH]
            ridx = ELIG[torch.randint(len(ELIG), (RECON_BATCH,), device=device)]
            wb = tf.who_batch(ridx)
            mu, lv, _ = model.who.encode(wb, True)
            rl = model.who.recon_loss(reparam(mu, lv), wb)
            kw = kl(mu, lv)
            lb = tf.look_batch(ridx)
            mu2, lv2, _ = model.look.encode(lb, True)
            rl2 = model.look.recon_loss(reparam(mu2, lv2), lb)
            kl2 = kl(mu2, lv2)
            loss = sum(rl.values()) + sum(rl2.values()) + BETA * (kw + kl2)
            parts: dict[str, torch.Tensor] = {
                "recon_who": sum(rl.values()),
                "recon_look": sum(rl2.values()),
                "kl": kw + kl2,
            }
            a = A[idx]
            b = Bi[idx]
            la, lb_bias = model.look_vec(tf.look_batch(a), True)
            wb_, wb_bias = model.who_vec(tf.who_batch(b), True)
            C = la @ wb_.T + lb_bias[:, None] + wb_bias[None, :]
            pl = pair_loss(NEG_WEIGHT, C, Y[idx], W[idx])
            loss = loss + pl
            parts["pair"] = pl
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            sched.step()
            step += 1
            for k_, v_ in parts.items():
                acc[k_] = acc.get(k_, 0.0) + float(v_)
            if step % 200 == 0:
                say(f"ep {epoch} step {step}/{total} "
                    + " ".join(f"{k_}={v_ / 200:.4f}" for k_, v_ in acc.items())
                    + f" t={time.time() - t0:.0f}s")
                acc = {}
        who, look, wbias, lbias = all_vectors(model, tf, f.n)
        sc = scorer_from(who, look, wbias, lbias, device)
        say(f"epoch {epoch} eval", json.dumps(quick_metrics(sc, ed)))

    who, look, wbias, lbias = all_vectors(model, tf, f.n)
    for name, vectors in [("who", who), ("look", look), ("wbias", wbias),
                          ("lbias", lbias)]:
        np.save(os.path.join(out, f"{name}.npy"), vectors)
    torch.save(model.state_dict(), os.path.join(out, "model.pt"))
    sc = scorer_from(who, look, wbias, lbias, device)
    model_metrics = quick_metrics(sc, ed)
    prod_metrics = quick_metrics(prod, ed)
    for metrics, scorer in [(model_metrics, sc), (prod_metrics, prod)]:
        metrics.update(retrieval_metrics(scorer, ed))
        metrics.update(exposure_metrics(scorer, ed))
        metrics.update(agreement_probe(scorer, ed))
    res: dict[str, dict[str, float]] = {
        "model": model_metrics,
        "prod": prod_metrics,
    }
    say("final", json.dumps(res, indent=1))
    with open(os.path.join(out, "metrics.json"), "w") as fh:
        json.dump({"args": vars(args), **res}, fh, indent=1)


def main() -> None:
    args = parse()
    ensure_dirs()
    out = run_dir(args.name)
    os.makedirs(out, exist_ok=True)
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    with open(os.path.join(out, "log.txt"), "a") as log:
        run(args, out, log)


if __name__ == "__main__":
    main()
