import argparse
import json
import os
import time
from typing import TextIO

import numpy as np
import pandas as pd
import torch

from kvmatching.cache import load_evaldata, load_features
from kvmatching.evaluate import (
    Scorer,
    agreement_probe,
    exposure_metrics,
    prod_scorer,
    quick_metrics,
    retrieval_metrics,
)
from kvmatching.features import Features, TensorFeatures
from kvmatching.model import KVModel, Noise, kl, reparam
from kvmatching.pairs import SPLIT, directed_labels, load_interactions, replies
from kvmatching.paths import DATA, ensure_dirs, run_dir
from serviceshared.kvmatching.blocks import FloatArray


def parse() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--name", default="model", help="run name, written under KV_WORK_DIR/runs")
    p.add_argument("--m", type=int, default=64)
    p.add_argument("--n", type=int, default=32)
    p.add_argument("--hidden", type=int, default=1024)
    p.add_argument("--layers", type=int, default=4)
    p.add_argument("--dropout", type=float, default=0.1)
    p.add_argument("--beta", type=float, default=1e-3)
    p.add_argument("--neg-weight", type=float, default=1.0)
    p.add_argument("--skip-weight", type=float, default=1.0)
    p.add_argument("--epochs", type=int, default=8)
    p.add_argument("--batch", type=int, default=2048)
    p.add_argument("--recon-batch", type=int, default=1024)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--wd", type=float, default=1e-4)
    p.add_argument("--noise-answer", type=float, default=0.3)
    p.add_argument("--noise-cat", type=float, default=0.1)
    p.add_argument("--noise-pref", type=float, default=0.1)
    p.add_argument("--noise-year", type=float, default=0.1, help="chance of shifting a training example's birth year by one, so the encoder stays smooth just past the cohorts it has seen")
    p.add_argument("--noise-beh", type=float, default=0.3, help="chance of zeroing a training example's behaviour block; see WhoDVAE.build_input")
    p.add_argument("--noise-prof", type=float, default=0.3, help="chance of zeroing a training example's profile-quality block")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--full-eval", type=int, default=1)
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
                lbias: FloatArray, device: torch.device,
                use_wbias: bool = True, use_lbias: bool = True) -> Scorer:
    """Append bias dims so that look'.who' = look.who + lbias + wbias. wbias
    is the prospect's popularity term, lbias the searcher's eagerness term;
    either can be switched off at scoring time."""
    n = len(who)
    ones = np.ones((n, 1), dtype=np.float32)
    zeros = np.zeros(n, dtype=np.float32)
    if not use_wbias:
        wbias = zeros
    if not use_lbias:
        lbias = zeros
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
    f = load_features()
    ed = load_evaldata(f)
    tf = TensorFeatures(f, device)
    tp = train_pairs(f)
    say("train pairs", len(tp), "pos", int((tp.label > 0).sum()),
        "neg", int((tp.label < 0).sum()))

    w = np.where(tp.label > 0, 1.0, args.skip_weight).astype(np.float32)
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

    noise = Noise(args.noise_answer, args.noise_cat, args.noise_pref,
                  args.noise_year, args.noise_beh, args.noise_prof)
    model = KVModel(tf, args.m, args.n, args.hidden, args.layers, noise,
                    args.dropout).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.wd)
    steps_per_epoch = len(tp) // args.batch
    total = steps_per_epoch * args.epochs
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=args.lr, total_steps=total, pct_start=0.05)

    prod = prod_scorer(f, device)
    say("prod", json.dumps(quick_metrics(prod, ed)))

    step = 0
    t0 = time.time()
    for epoch in range(args.epochs):
        perm = torch.randperm(len(tp), device=device)
        acc: dict[str, float] = {}
        for i in range(steps_per_epoch):
            idx = perm[i * args.batch:(i + 1) * args.batch]
            ridx = ELIG[torch.randint(len(ELIG), (args.recon_batch,), device=device)]
            wb = tf.who_batch(ridx)
            mu, lv = model.who.encode(wb, True)
            rl = model.who.recon_loss(reparam(mu, lv), wb)
            kw = kl(mu, lv)
            lb = tf.look_batch(ridx)
            mu2, lv2 = model.look.encode(lb, True)
            rl2 = model.look.recon_loss(reparam(mu2, lv2), lb)
            kl2 = kl(mu2, lv2)
            loss = sum(rl.values()) + sum(rl2.values()) + args.beta * (kw + kl2)
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
            pl = pair_loss(args.neg_weight, C, Y[idx], W[idx])
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
    np.save(os.path.join(out, "who.npy"), who)
    np.save(os.path.join(out, "look.npy"), look)
    np.save(os.path.join(out, "wbias.npy"), wbias)
    np.save(os.path.join(out, "lbias.npy"), lbias)
    torch.save(model.state_dict(), os.path.join(out, "model.pt"))
    sc = scorer_from(who, look, wbias, lbias, device)
    model_metrics = quick_metrics(sc, ed)
    prod_metrics = quick_metrics(prod, ed)
    if args.full_eval:
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
