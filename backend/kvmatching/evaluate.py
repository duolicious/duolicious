import numpy as np
import numpy.typing as npt
import pandas as pd
import torch
from sklearn.metrics import roc_auc_score

from kvmatching.features import Features
from kvmatching.pairs import SPLIT, directed_labels, load_interactions, replies
from serviceshared.kvmatching.blocks import FloatArray, IntArray

BoolArray = npt.NDArray[np.bool_]


class EvalData:
    """Held-out interactions (from SPLIT onward) and candidate pools, all in
    row-index space of Features."""

    def __init__(self, f: Features, seed: int = 0) -> None:
        self.f = f
        p = f.people
        df = load_interactions()
        lab = directed_labels(df)
        lab = lab[lab["t"] >= SPLIT]
        ra = f.pid2row.reindex(lab["a"]).to_numpy()
        rb = f.pid2row.reindex(lab["b"]).to_numpy()
        ok = ~np.isnan(ra) & ~np.isnan(rb)
        self.dir_a = ra[ok].astype(int)
        self.dir_b = rb[ok].astype(int)
        self.dir_y = (lab["label"].to_numpy()[ok] == 1)

        r = replies(df)
        r = r[r["initiated"] & (r["messaged_at"] >= SPLIT)]
        ra = f.pid2row.reindex(r["subject_person_id"]).to_numpy()
        rb = f.pid2row.reindex(r["object_person_id"]).to_numpy()
        ok = ~np.isnan(ra) & ~np.isnan(rb)
        self.rep_a = ra[ok].astype(int)
        self.rep_b = rb[ok].astype(int)
        self.rep_y = r["replied"].to_numpy()[ok]
        self.rep_skipped_back = r["skipped_back"].to_numpy()[ok]

        rng = np.random.default_rng(seed)
        self.rng = rng
        eligible = (p["activated"] & ~p["is_bot"] & ~p["shadow_banned"]).to_numpy()
        self.pool = np.flatnonzero(eligible)
        self.gender = p["gender_id"].to_numpy()
        self.gender_ok = f.pref_multi[0].astype(bool)

        mutual = self.rep_y
        qa = self.rep_a[mutual]
        qb = self.rep_b[mutual]
        sel = rng.choice(len(qa), size=min(4000, len(qa)), replace=False)
        self.q_a = qa[sel]
        self.q_b = qb[sel]
        self.q_cands = [self._candidates(a, b, 2000) for a, b in zip(self.q_a, self.q_b)]

        recent = (p["last_online_time"] >= SPLIT).to_numpy()
        has_photo = p["photo_count"].to_numpy() > 0
        self.exposure_pool = np.flatnonzero(eligible & recent & has_photo)
        actors = np.unique(np.concatenate([self.dir_a, self.rep_a]))
        actors = actors[np.isin(actors, self.exposure_pool)]
        self.searchers = rng.choice(actors, size=min(3000, len(actors)), replace=False)

    def _mutual_gender_mask(self, a: int, cands: IntArray) -> BoolArray:
        ga = self.gender[a]
        gc = self.gender[cands]
        ok_a = self.gender_ok[a][gc]
        ok_c = self.gender_ok[cands, ga]
        return ok_a & ok_c

    def _candidates(self, a: int, b: int, k: int) -> IntArray:
        cands = self.rng.choice(self.pool, size=k * 3, replace=False)
        cands = cands[(cands != a) & (cands != b)]
        cands = cands[self._mutual_gender_mask(a, cands)][:k]
        return np.concatenate([[b], cands])

    def exposure_candidates(self, a: int) -> IntArray:
        c = self.exposure_pool
        c = c[c != a]
        return c[self._mutual_gender_mask(a, c)]


def safe_auc(y: BoolArray, s: FloatArray) -> float:
    if y.sum() == 0 or y.sum() == len(y):
        return float("nan")
    return float(roc_auc_score(y, s))


def gini(x: FloatArray | IntArray) -> float:
    v = np.sort(np.asarray(x, dtype=np.float64))
    n = len(v)
    if v.sum() == 0:
        return 0.0
    return float((2 * np.arange(1, n + 1) - n - 1).dot(v) / (n * v.sum()))


class Scorer:
    """score(a -> b) = look[a] . who[b]; reciprocal = both directions summed."""

    def __init__(self, look: FloatArray, who: FloatArray, device: torch.device) -> None:
        self.look = torch.as_tensor(look, dtype=torch.float32, device=device)
        self.who = torch.as_tensor(who, dtype=torch.float32, device=device)
        self.device = device

    def directed(self, a: IntArray, b: IntArray) -> FloatArray:
        a_t = torch.as_tensor(a, device=self.device)
        b_t = torch.as_tensor(b, device=self.device)
        return (self.look[a_t] * self.who[b_t]).sum(1).cpu().numpy()

    def reciprocal(self, a: IntArray, b: IntArray) -> FloatArray:
        return self.directed(a, b) + self.directed(b, a)

    def rank_of_first(self, a: int, cands: IntArray, mode: str) -> int:
        a_arr = np.full(len(cands), a)
        s = self.reciprocal(a_arr, cands) if mode == "recip" else self.directed(a_arr, cands)
        target = s[0]
        return int((s[1:] > target).sum() + 1)

    def topk(self, a: int, cands: IntArray, k: int, mode: str) -> IntArray:
        a_arr = np.full(len(cands), a)
        s = self.reciprocal(a_arr, cands) if mode == "recip" else self.directed(a_arr, cands)
        idx = np.argpartition(-s, min(k, len(s) - 1))[:k]
        return cands[idx]


def quick_metrics(sc: Scorer, ed: EvalData) -> dict[str, float]:
    out: dict[str, float] = {}
    out["dir_auc"] = safe_auc(ed.dir_y, sc.directed(ed.dir_a, ed.dir_b))
    out["reply_auc_b2a"] = safe_auc(ed.rep_y, sc.directed(ed.rep_b, ed.rep_a))
    out["reply_auc_recip"] = safe_auc(ed.rep_y, sc.reciprocal(ed.rep_a, ed.rep_b))
    out["skipback_auc_b2a"] = safe_auc(
        ed.rep_skipped_back, -sc.directed(ed.rep_b, ed.rep_a))
    out.update(inbox_metrics(sc, ed))
    return out


def retrieval_metrics(sc: Scorer, ed: EvalData) -> dict[str, float]:
    out: dict[str, float] = {}
    for mode in ["recip", "dir"]:
        ranks = np.array([
            sc.rank_of_first(a, c, mode) for a, c in zip(ed.q_a, ed.q_cands)])
        out[f"recall@10_{mode}"] = float((ranks <= 10).mean())
        out[f"recall@50_{mode}"] = float((ranks <= 50).mean())
        out[f"mrr_{mode}"] = float((1.0 / ranks).mean())
    return out


def exposure_metrics(sc: Scorer, ed: EvalData, k: int = 50, mode: str = "recip") -> dict[str, float]:
    counts = np.zeros(ed.f.n, dtype=np.int64)
    for a in ed.searchers:
        cands = ed.exposure_candidates(a)
        if len(cands) == 0:
            continue
        top = sc.topk(a, cands, k, mode)
        counts[top] += 1
    pool_counts = counts[ed.exposure_pool]
    srt = np.sort(pool_counts)[::-1]
    total = srt.sum()
    top1 = max(1, len(srt) // 100)
    return {
        "exposure_gini": gini(pool_counts),
        "exposure_top1pct_share": float(srt[:top1].sum() / max(total, 1)),
        "exposure_zero_frac": float((pool_counts == 0).mean()),
        "exposure_max": int(srt[0]),
    }


def prod_scorer(f: Features, device: torch.device) -> Scorer:
    return Scorer(f.personality, f.personality, device)



POLITICAL_QIDS = [167, 275, 666, 727, 1108, 1380, 1469, 1776, 1340, 242, 186, 73]
SEX_QIDS = [40, 60, 132, 32, 108, 127, 89, 49, 21, 327, 168, 243]


def disagreement(f: Features, a: IntArray, b: IntArray, qids: list[int]) -> float:
    cols = [int(np.flatnonzero(f.qids == q)[0]) for q in qids]
    A = f.answers[a][:, cols].astype(np.int16)
    B = f.answers[b][:, cols].astype(np.int16)
    both = (A != 0) & (B != 0)
    dis = (A * B < 0) & both
    return float(dis.sum() / max(both.sum(), 1))


def agreement_probe(sc: Scorer, ed: EvalData, k: int = 50, mode: str = "recip",
                    n_searchers: int = 1000) -> dict[str, float]:
    f = ed.f
    a_parts, b_parts = [], []
    for a in ed.searchers[:n_searchers]:
        cands = ed.exposure_candidates(a)
        if len(cands) == 0:
            continue
        top = sc.topk(a, cands, k, mode)
        a_parts.append(np.full(len(top), a))
        b_parts.append(top)
    a_all = np.concatenate(a_parts)
    b_all = np.concatenate(b_parts)
    rng = np.random.default_rng(1)
    rb = rng.choice(ed.exposure_pool, size=len(b_all))
    return {
        "political_disagree_top": disagreement(f, a_all, b_all, POLITICAL_QIDS),
        "political_disagree_random": disagreement(f, a_all, rb, POLITICAL_QIDS),
        "sex_disagree_top": disagreement(f, a_all, b_all, SEX_QIDS),
        "sex_disagree_random": disagreement(f, a_all, rb, SEX_QIDS),
    }


def grouped_auc(group: IntArray, y: BoolArray, s: FloatArray,
                min_size: int = 3) -> float:
    """Macro-averaged AUC within groups (Mann-Whitney via ranks), over
    groups with both classes present and at least `min_size` rows."""
    df = pd.DataFrame({"g": group, "y": y.astype(int), "s": s})
    df["r"] = df.groupby("g")["s"].rank(method="average")
    agg = df.groupby("g").agg(n=("y", "size"), npos=("y", "sum"))
    rpos = df[df.y == 1].groupby("g")["r"].sum()
    agg["rpos"] = rpos.reindex(agg.index).fillna(0)
    agg["nneg"] = agg["n"] - agg["npos"]
    ok = (agg["npos"] > 0) & (agg["nneg"] > 0) & (agg["n"] >= min_size)
    a = agg[ok]
    auc = (a["rpos"] - a["npos"] * (a["npos"] + 1) / 2) / (a["npos"] * a["nneg"])
    return float(auc.mean())


def inbox_metrics(sc: Scorer, ed: EvalData) -> dict[str, float]:
    """Per-recipient ranking of the senders in their held-out inbox."""
    out: dict[str, float] = {}
    out["inbox_auc_b2a"] = grouped_auc(ed.rep_b, ed.rep_y, sc.directed(ed.rep_b, ed.rep_a))
    out["inbox_auc_recip"] = grouped_auc(ed.rep_b, ed.rep_y, sc.reciprocal(ed.rep_a, ed.rep_b))
    out["per_sender_auc_a2b"] = grouped_auc(ed.dir_a, ed.dir_y, sc.directed(ed.dir_a, ed.dir_b))
    return out

