import argparse
import json
import zlib
from pathlib import Path

import numpy as np
import numpy.typing as npt
import psycopg
import torch
from psycopg.rows import dict_row
from sklearn.metrics import roc_auc_score
from torch import nn

from serviceshared.antiabuse.highrisk import encoder, features, ipinfo, model
from serviceshared.antiabuse.highrisk.sql import (
    Q_ACTIVITY,
    Q_LINKED,
    Q_MESSAGES,
    Q_PHOTOS,
    Q_PROFILES,
    Q_SESSIONS,
)

TEXTS = ('bio', 'messages', 'origin')
VECTORS = ('bio', 'sent')
FOLDS = 5
TARGET_FPR = 0.015
BLOCKED_ASNS = frozenset(json.loads((
    Path(__file__).parents[1]
    / 'serviceshared/antiabuse/anonymizers/asnblock/blocked-asns.json'
).read_text()))

LEARNING_RATE = 1e-3
WEIGHT_DECAY = 0.3
DROPOUT = 0.5
EMBEDDING = 32
BUCKETS = 1 << 14
WIDTH = 64
EPOCHS = 12
BATCH = 64


class Net(nn.Module):
    def __init__(self, d_tab: int) -> None:
        super().__init__()
        self.tab = nn.Sequential(
            nn.Linear(d_tab, WIDTH), nn.ReLU(), nn.Dropout(DROPOUT),
            nn.Linear(WIDTH, 128))
        self.clip = nn.Sequential(nn.Dropout(DROPOUT), nn.Linear(1537, 64))
        self.vectors = nn.ModuleDict({
            name: nn.Sequential(
                nn.Dropout(DROPOUT), nn.Linear(encoder.WIDTH, 64))
            for name in VECTORS})
        self.bags = nn.ModuleDict({
            name: nn.EmbeddingBag(BUCKETS, EMBEDDING, mode='mean')
            for name in TEXTS})
        self.head = nn.Sequential(
            nn.ReLU(), nn.Dropout(DROPOUT),
            nn.Linear(
                128 + 64 + len(VECTORS) * 64 + len(TEXTS) * EMBEDDING, WIDTH),
            nn.ReLU(), nn.Dropout(DROPOUT), nn.Linear(WIDTH, 1))

    def forward(
        self,
        tab: torch.Tensor,
        clip: torch.Tensor,
        vectors: dict[str, torch.Tensor],
        bags: dict[str, tuple[torch.Tensor, torch.Tensor]],
    ) -> torch.Tensor:
        return self.head(torch.cat([
            self.tab(tab), self.clip(clip),
            *(self.vectors[name](vectors[name]) for name in VECTORS),
            *(self.bags[name](*bags[name]) for name in TEXTS)], 1))[:, 0]


def gated(sessions: list[features.Session]) -> set[int]:
    lo, hi = features.SIGN_UP_SESSION_HOURS
    return {
        s.person_id for s in sessions
        if s.hours == 0 and lo <= s.hours_after_sign_up <= hi
        and ipinfo.lookup(s.ip).asn in BLOCKED_ASNS
    }


def load(dsn: str, ids: list[int]) -> list[features.Example]:
    params = dict(
        person_ids=[i for i in ids for _ in features.CHECKPOINT_HOURS],
        hours=[h for _ in ids for h in features.CHECKPOINT_HOURS])
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        conn.read_only = True
        sessions = [
            features.Session(**r) for r in conn.execute(Q_SESSIONS, params)]
        examples = features.build(
            profiles=[
                features.Profile(**r) for r in conn.execute(Q_PROFILES, params)],
            photos=features.group_photos([
                features.Photo(**r) for r in conn.execute(Q_PHOTOS, params)]),
            sessions=sessions,
            messages=[
                features.Message(**r) for r in conn.execute(Q_MESSAGES, params)],
            activity=[
                features.Activity(**r) for r in conn.execute(Q_ACTIVITY, params)],
            linked=[
                features.Linked(**r) for r in conn.execute(Q_LINKED, params)],
        )
    blocked = gated(sessions)
    print(f'{len(blocked)} people dropped whose sign-up network is now blocked')
    return [e for e in examples if e.person_id not in blocked]


def load_labels(path: Path) -> dict[int, bool]:
    latest = {}
    for line in path.open():
        row = json.loads(line)
        latest[row['id']] = row['label']
    return {
        i: label == 'should be required to verify'
        for i, label in latest.items() if label}


def fit_stats(examples: list[features.Example]) -> tuple[
        dict[str, list[str]], dict[str, npt.NDArray[np.float32]]]:
    columns = sorted(examples[0].numbers)
    raw = model.numbers(examples, columns)
    median = np.nanmedian(raw, axis=0)
    filled = np.where(np.isnan(raw), median, raw)
    std = filled.std(axis=0, ddof=1)
    meta = dict(numbers=columns, texts=list(TEXTS), vectors=list(VECTORS))
    return meta, dict(
        median=median,
        mean=filled.mean(axis=0),
        std=np.where(std == 0, 1, std).astype(np.float32),
        has_missing=np.isnan(raw).any(axis=0).astype(np.float32),
    )


Bags = dict[str, list[npt.NDArray[np.int64]]]


def bags(examples: list[features.Example]) -> Bags:
    return {
        name: [
            features.ngrams(e.texts[name], BUCKETS) if e.texts[name]
            else np.zeros(0, np.int64) for e in examples]
        for name in TEXTS
    }


class Data:
    def __init__(
        self,
        examples: list[features.Example],
        bags: Bags,
        meta: dict[str, list[str]],
        stats: dict[str, npt.NDArray[np.float32]],
    ) -> None:
        self.tab = torch.tensor(model.tabular(examples, meta, stats)).cuda()
        self.clip = torch.tensor(model.photos(examples)).cuda()
        self.vectors = {
            name: torch.tensor(np.stack([
                e.vectors[name] for e in examples])).cuda()
            for name in VECTORS}
        self.bags = bags

    def bag(
        self,
        name: str,
        rows: npt.NDArray[np.int64],
    ) -> tuple[torch.Tensor, torch.Tensor]:
        pieces = [self.bags[name][r] for r in rows]
        offsets = np.cumsum([0] + [len(p) for p in pieces[:-1]])
        return (torch.tensor(np.concatenate(pieces)).cuda(),
                torch.tensor(offsets).cuda())

    def batch(self, rows: npt.NDArray[np.int64]) -> tuple[
            torch.Tensor, torch.Tensor, dict[str, torch.Tensor],
            dict[str, tuple[torch.Tensor, torch.Tensor]]]:
        t = torch.tensor(rows).cuda()
        return (
            self.tab[t], self.clip[t],
            {name: self.vectors[name][t] for name in VECTORS},
            {name: self.bag(name, rows) for name in TEXTS})


def train(
    data: Data,
    rows: npt.NDArray[np.int64],
    target: npt.NDArray[np.float32],
    seed: int,
) -> Net:
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    net = Net(data.tab.shape[1]).cuda()
    opt = torch.optim.AdamW(
        net.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY)
    y = torch.tensor(target).cuda()
    net.train()
    for _ in range(EPOCHS):
        order = rng.permutation(rows)
        for k in range(0, len(order), BATCH):
            b = order[k:k + BATCH]
            loss = nn.functional.binary_cross_entropy_with_logits(
                net(*data.batch(b)), y[torch.tensor(b).cuda()])
            opt.zero_grad()
            loss.backward()
            opt.step()
    return net.eval()


def export(net: Net, meta: dict[str, list[str]],
           stats: dict[str, npt.NDArray[np.float32]], path: Path) -> None:
    np.savez(
        path,
        meta=np.array(json.dumps(meta)),
        **stats,
        **{k: v.detach().cpu().numpy().astype(np.float16)
           for k, v in net.state_dict().items()},
    )


def recall_at(scores: npt.NDArray[np.float32],
              labels: npt.NDArray[np.bool_]) -> tuple[float, float]:
    negatives = np.sort(scores[~labels])[::-1]
    allowed = int(TARGET_FPR * len(negatives))
    threshold = negatives[allowed] if allowed < len(negatives) else -np.inf
    return float((scores[labels] > threshold).mean()), float(threshold)


def predict(net: Net, data: Data, rows: npt.NDArray[np.int64]) -> npt.NDArray[np.float32]:
    with torch.inference_mode():
        return np.concatenate([
            torch.sigmoid(net(*data.batch(rows[k:k + 8192]))).cpu().numpy()
            for k in range(0, len(rows), 8192)])


def out_of_fold(examples: list[features.Example],
                target: npt.NDArray[np.float32]) -> npt.NDArray[np.float32]:
    fold = np.array([
        zlib.crc32(str(e.person_id).encode()) % FOLDS for e in examples])
    scores = np.zeros(len(examples), np.float32)
    example_bags = bags(examples)
    for k in range(FOLDS):
        meta, stats = fit_stats([e for e, f in zip(examples, fold) if f != k])
        data = Data(examples, example_bags, meta, stats)
        net = train(data, np.flatnonzero(fold != k), target, seed=k)
        scores[fold == k] = predict(net, data, np.flatnonzero(fold == k))
    return scores


def report(examples: list[features.Example], scores: npt.NDArray[np.float32],
           target: npt.NDArray[np.float32]) -> None:
    for hours in features.CHECKPOINT_HOURS:
        m = np.array([e.hours == hours for e in examples])
        y = target[m] == 1
        recall, _ = recall_at(scores[m], y)
        print(f'{hours} h: AUC {roc_auc_score(y, scores[m]):.3f}, '
              f'catches {recall:.0%} when flagging {TARGET_FPR:.1%} of '
              '"should not" profiles')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('labels', type=Path)
    parser.add_argument('--dsn', default='postgresql://postgres:password@localhost:5432/duo_api')
    parser.add_argument('--evaluate', action='store_true')
    args = parser.parse_args()

    labels = load_labels(args.labels)
    examples = load(args.dsn, sorted(labels))
    target = np.array([labels[e.person_id] for e in examples], np.float32)

    if args.evaluate:
        report(examples, out_of_fold(examples, target), target)
        return

    meta, stats = fit_stats(examples)
    data = Data(examples, bags(examples), meta, stats)
    net = train(data, np.arange(len(examples)), target, seed=0)
    path = Path(model.__file__).parent / 'model.npz'
    export(net, meta, stats, path)
    print('wrote', path)


if __name__ == '__main__':
    main()
