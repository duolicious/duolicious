import numpy as np
import numpy.typing as npt
import pandas as pd
import torch
from sklearn.metrics import roc_auc_score

from kvmatching.features import Features
from kvmatching.pairs import SPLIT, directed_labels, load_interactions, replies
from serviceshared.kvmatching.blocks import FloatArray, IntArray

BoolArray = npt.NDArray[np.bool_]
POLITICAL_QIDS = [167, 275, 666, 727, 1108, 1380, 1469, 1776, 1340, 242, 186, 73]
SEX_QIDS = [40, 60, 132, 32, 108, 127, 89, 49, 21, 327, 168, 243]


class EvalData:
    """Held-out interactions (from SPLIT onward) and candidate pools, all in
    row-index space of Features."""

    def __init__(self, f: Features, seed: int = 0) -> None:
        self.f = f
        p = f.people
        df = load_interactions()
        lab = directed_labels(df)
        lab = lab[lab["t"] >= SPLIT]
        self.dir_a, self.dir_b, ok = self._rows(lab["a"], lab["b"])
        self.dir_y = (lab["label"].to_numpy()[ok] == 1)

        r = replies(df)
        r = r[r["initiated"] & (r["messaged_at"] >= SPLIT)]
        self.rep_a, self.rep_b, ok = self._rows(
            r["subject_person_id"], r["object_person_id"])
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

    def _rows(self, a: "pd.Series[int]",
              b: "pd.Series[int]") -> tuple[IntArray, IntArray, BoolArray]:
        ra = self.f.pid2row.reindex(a).to_numpy()
        rb = self.f.pid2row.reindex(b).to_numpy()
        ok = ~np.isnan(ra) & ~np.isnan(rb)
        return ra[ok].astype(int), rb[ok].astype(int), ok

    def _mutual_gender_mask(self, a: int, cands: IntArray) -> BoolArray:
        ok_a = self.gender_ok[a][self.gender[cands]]
        ok_c = self.gender_ok[cands, self.gender[a]]
        return ok_a & ok_c

    def _candidates(self, a: int, b: int, k: int) -> IntArray:
        cands = self.rng.choice(self.pool, size=k * 3, replace=False)
        cands = cands[(cands != a) & (cands != b)]
        cands = cands[self._mutual_gender_mask(a, cands)][:k]
        return np.concatenate([[b], cands])

    def exposure_candidates(self, a: int) -> IntArray:
        c = self.exposure_pool[self.exposure_pool != a]
        return c[self._mutual_gender_mask(a, c)]


def safe_auc(y: BoolArray, s: FloatArray) -> float:
    if y.sum() == 0 or y.sum() == len(y):
        return float("nan")
    return float(roc_auc_score(y, s))


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
    a = agg[(agg["npos"] > 0) & (agg["nneg"] > 0) & (agg["n"] >= min_size)]
    auc = (a["rpos"] - a["npos"] * (a["npos"] + 1) / 2) / (a["npos"] * a["nneg"])
    return float(auc.mean())


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

    def against(self, a: int, cands: IntArray, mode: str) -> FloatArray:
        a_arr = np.full(len(cands), a)
        if mode == "recip":
            return self.reciprocal(a_arr, cands)
        return self.directed(a_arr, cands)

    def rank_of_first(self, a: int, cands: IntArray, mode: str) -> int:
        s = self.against(a, cands, mode)
        return int((s[1:] > s[0]).sum() + 1)

    def topk(self, a: int, cands: IntArray, k: int, mode: str) -> IntArray:
        s = self.against(a, cands, mode)
        return cands[np.argpartition(-s, min(k, len(s) - 1))[:k]]


def prod_scorer(f: Features, device: torch.device) -> Scorer:
    return Scorer(f.personality, f.personality, device)


def served_lists(sc: Scorer, ed: EvalData, k: int, mode: str,
                 searchers: IntArray) -> list[tuple[int, IntArray]]:
    out = []
    for a in searchers:
        cands = ed.exposure_candidates(a)
        if len(cands):
            out.append((int(a), sc.topk(a, cands, k, mode)))
    return out


def quick_metrics(sc: Scorer, ed: EvalData) -> dict[str, float]:
    b2a = sc.directed(ed.rep_b, ed.rep_a)
    recip = sc.reciprocal(ed.rep_a, ed.rep_b)
    dir_s = sc.directed(ed.dir_a, ed.dir_b)
    return {
        "dir_auc": safe_auc(ed.dir_y, dir_s),
        "reply_auc_b2a": safe_auc(ed.rep_y, b2a),
        "reply_auc_recip": safe_auc(ed.rep_y, recip),
        "skipback_auc_b2a": safe_auc(ed.rep_skipped_back, -b2a),
        "inbox_auc_b2a": grouped_auc(ed.rep_b, ed.rep_y, b2a),
        "inbox_auc_recip": grouped_auc(ed.rep_b, ed.rep_y, recip),
        "per_sender_auc_a2b": grouped_auc(ed.dir_a, ed.dir_y, dir_s),
    }


def retrieval_metrics(sc: Scorer, ed: EvalData) -> dict[str, float]:
    out: dict[str, float] = {}
    for mode in ["recip", "dir"]:
        ranks = np.array([
            sc.rank_of_first(a, c, mode) for a, c in zip(ed.q_a, ed.q_cands)])
        out[f"recall@10_{mode}"] = float((ranks <= 10).mean())
        out[f"recall@50_{mode}"] = float((ranks <= 50).mean())
        out[f"mrr_{mode}"] = float((1.0 / ranks).mean())
    return out


def exposure_metrics(sc: Scorer, ed: EvalData, k: int = 50,
                     mode: str = "recip") -> dict[str, float]:
    counts = np.zeros(ed.f.n, dtype=np.int64)
    for _, top in served_lists(sc, ed, k, mode, ed.searchers):
        counts[top] += 1
    pool_counts = counts[ed.exposure_pool]
    srt = np.sort(pool_counts)[::-1]
    top1 = max(1, len(srt) // 100)
    return {
        "exposure_gini": gini(pool_counts),
        "exposure_top1pct_share": float(srt[:top1].sum() / max(srt.sum(), 1)),
        "exposure_zero_frac": float((pool_counts == 0).mean()),
        "exposure_max": int(srt[0]),
    }


def disagreement(f: Features, a: IntArray, b: IntArray, qids: list[int]) -> float:
    cols = [int(np.flatnonzero(f.qids == q)[0]) for q in qids]
    A = f.answers[a][:, cols].astype(np.int16)
    B = f.answers[b][:, cols].astype(np.int16)
    both = (A != 0) & (B != 0)
    return float(((A * B < 0) & both).sum() / max(both.sum(), 1))


def agreement_probe(sc: Scorer, ed: EvalData, k: int = 50, mode: str = "recip",
                    n_searchers: int = 1000) -> dict[str, float]:
    served = served_lists(sc, ed, k, mode, ed.searchers[:n_searchers])
    a_all = np.concatenate([np.full(len(top), a) for a, top in served])
    b_all = np.concatenate([top for _, top in served])
    rb = np.random.default_rng(1).choice(ed.exposure_pool, size=len(b_all))
    out: dict[str, float] = {}
    for name, qids in [("political", POLITICAL_QIDS), ("sex", SEX_QIDS)]:
        out[f"{name}_disagree_top"] = disagreement(ed.f, a_all, b_all, qids)
        out[f"{name}_disagree_random"] = disagreement(ed.f, a_all, rb, qids)
    return out
