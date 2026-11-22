import argparse
import json
import multiprocessing
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from itertools import repeat
from pathlib import Path

import numpy as np
import numpy.typing as npt
import psycopg
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from psycopg.rows import dict_row
from torch import nn
from transformers import (
    AutoModel,
    AutoModelForSequenceClassification,
    AutoTokenizer,
    get_linear_schedule_with_warmup,
)

from serviceshared import introscore

BASE = 'sentence-transformers/all-MiniLM-L6-v2'
TEACHER = 'cardiffnlp/twitter-roberta-large-2022-154m'
TEACHER_FOLDS = 5
LAYERS = 4
BINS = 16
CATEGORIES = 32
LABELS = ('negative', 'neutral', 'positive')
POSITIVE = LABELS.index('positive')
HELD_OUT_RECIPIENTS = 5

TEACHER_LEARNING_RATE = 1.5e-5
ENCODER_LEARNING_RATE = 1e-4
LEARNING_RATE = 1e-3
WEIGHT_DECAY = 0.01
DROPOUT = 0.1
REPLY_WEIGHT = 0.3
EPOCHS = 2
BATCH = 32

Q_MESSAGED = """
SELECT
    subject_person_id,
    object_person_id,
    created_at
FROM
    messaged
"""

Q_BODIES = """
SELECT
    intro.sender_id,
    intro.recipient_id,
    first_message.body
FROM
    unnest(%(sender_ids)s::INT[], %(recipient_ids)s::INT[])
    AS intro(sender_id, recipient_id)
JOIN
    person AS sender
ON
    sender.id = intro.sender_id
CROSS JOIN LATERAL (
    SELECT
        body
    FROM
        mam_message
    WHERE
        person_id = intro.recipient_id
    AND
        remote_bare_jid = sender.uuid::TEXT
    AND
        direction = 'I'
    ORDER BY
        id
    LIMIT 1
) AS first_message
"""


@dataclass(frozen=True)
class Data:
    recipient_id: npt.NDArray[np.int64]
    label: npt.NDArray[np.int64]
    replied: npt.NDArray[np.bool_]
    bodies: list[str]
    numbers: npt.NDArray[np.float32]
    categories: npt.NDArray[np.int64]
    photos: npt.NDArray[np.float32]


def _pair(a: npt.NDArray[np.int64], b: npt.NDArray[np.int64]) -> npt.NDArray[np.int64]:
    return (a << 32) + b


def _moment(
    person_id: npt.NDArray[np.int64],
    at: npt.NDArray[np.datetime64],
) -> npt.NDArray[np.int64]:
    return (person_id << 42) + at.astype('datetime64[ms]').astype(np.int64)


def count_before(
    event_person_id: npt.NDArray[np.int64],
    event_at: npt.NDArray[np.datetime64],
    person_id: npt.NDArray[np.int64],
    at: npt.NDArray[np.datetime64],
) -> npt.NDArray[np.int64]:
    moments = np.sort(_moment(event_person_id, event_at))
    return (
        np.searchsorted(moments, _moment(person_id, at))
        - np.searchsorted(moments, person_id << 42))


def load_labels(path: Path) -> dict[tuple[int, int], int]:
    rows = [json.loads(line) for line in path.open()]
    return {
        (row['sender_id'], row['recipient_id']): LABELS.index(row['label'])
        for row in rows}


def load(dsn: str, labels: dict[tuple[int, int], int]) -> Data:
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        conn.read_only = True

        messaged = conn.execute(Q_MESSAGED).fetchall()
        subject = np.array([r['subject_person_id'] for r in messaged], np.int64)
        object_ = np.array([r['object_person_id'] for r in messaged], np.int64)
        at = np.array([r['created_at'] for r in messaged], 'datetime64[us]')

        order = np.argsort(_pair(subject, object_))
        pairs = _pair(subject, object_)[order]
        reverse = np.searchsorted(pairs, _pair(object_, subject)).clip(
            max=len(pairs) - 1)
        answered = pairs[reverse] == _pair(object_, subject)
        answered_at = at[order][reverse]
        is_intro = ~(answered & (answered_at < at))

        label = np.array([
            labels.get(pair, -1) for pair in zip(subject.tolist(), object_.tolist())])
        labelled = is_intro & (label >= 0)
        others = np.flatnonzero(
            is_intro & (label < 0) & (at >= at[labelled].min()))
        rows = np.concatenate([
            np.flatnonzero(labelled),
            np.random.default_rng(0).choice(
                others, labelled.sum(), replace=False)])

        bodies = {
            (r['sender_id'], r['recipient_id']): r['body']
            for r in conn.execute(Q_BODIES, dict(
                sender_ids=subject[rows].tolist(),
                recipient_ids=object_[rows].tolist()))}
        rows = np.array([
            i for i in rows if (subject[i], object_[i]) in bodies])

        people = {
            r['id']: introscore.Person(**r)
            for r in conn.execute(introscore.Q_PEOPLE, dict(
                person_ids=np.unique(
                    np.concatenate([subject[rows], object_[rows]])).tolist()))}

    counts = {
        role: dict(
            sent=count_before(
                subject[is_intro], at[is_intro], person_id[rows], at[rows]),
            received=count_before(
                object_[is_intro], at[is_intro], person_id[rows], at[rows]),
            sent_with_reply=count_before(
                object_[~is_intro], at[~is_intro], person_id[rows], at[rows]),
            received_with_reply=count_before(
                subject[~is_intro], at[~is_intro], person_id[rows], at[rows]))
        for role, person_id in (('sender', subject), ('recipient', object_))}

    def person(role: str, person_id: int, k: int) -> introscore.Person:
        return people[person_id].model_copy(update={
            name: int(count[k]) for name, count in counts[role].items()})

    inputs = [
        introscore.inputs(
            person('sender', subject[i], k),
            person('recipient', object_[i], k),
            at[i].item())
        for k, i in enumerate(rows)]

    return Data(
        recipient_id=object_[rows],
        label=label[rows],
        replied=answered[rows],
        bodies=[bodies[subject[i], object_[i]] for i in rows],
        numbers=np.stack([x['numbers'] for x in inputs]),
        categories=np.stack([x['categories'] for x in inputs]),
        photos=np.stack([x['photos'] for x in inputs]),
    )


class Net(nn.Module):
    def __init__(self, numbers: torch.Tensor) -> None:
        super().__init__()
        self.encoder = AutoModel.from_pretrained(BASE)
        self.encoder.encoder.layer = self.encoder.encoder.layer[:LAYERS]
        text_width = self.encoder.config.hidden_size

        edges = torch.nanquantile(
            numbers, torch.linspace(0, 1, BINS + 1), dim=0)
        self.register_buffer('low', edges[:-1])
        self.register_buffer('step', (edges[1:] - edges[:-1]).clamp(min=1e-6))

        n_numbers = numbers.shape[1]
        n_categories = 4
        self.categories = nn.ModuleList(
            nn.Embedding(CATEGORIES, 8) for _ in range(n_categories))
        self.photo = nn.Linear(introscore.CLIP_WIDTH, 32)
        self.table = nn.Sequential(
            nn.Linear(
                n_numbers * (BINS + 1) + n_categories * 8 + 2 * 33, 1024),
            nn.LayerNorm(1024), nn.GELU(), nn.Dropout(DROPOUT),
            nn.Linear(1024, 1024),
            nn.LayerNorm(1024), nn.GELU(), nn.Dropout(DROPOUT),
            nn.Linear(1024, 256), nn.GELU())
        self.head = nn.Sequential(
            nn.Dropout(DROPOUT), nn.Linear(text_width + 256, 512),
            nn.GELU(), nn.Dropout(DROPOUT), nn.Linear(512, len(LABELS) + 1))
        self.mimic = nn.Linear(text_width, len(LABELS))

    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: torch.Tensor,
        numbers: torch.Tensor,
        categories: torch.Tensor,
        photos: torch.Tensor,
    ) -> torch.Tensor:
        hidden = self.encoder(
            input_ids=input_ids, attention_mask=attention_mask,
        ).last_hidden_state
        mask = attention_mask[:, :, None].to(hidden.dtype)
        text = (hidden * mask).sum(1) / mask.sum(1)

        missing = numbers.isnan()
        bins = (
            (numbers.nan_to_num()[:, None] - self.low) / self.step
        ).clamp(0, 1)
        no_photo = photos.isnan()[:, :, :1]
        photo = self.photo(
            nn.functional.normalize(photos.nan_to_num(), dim=-1))
        table = self.table(torch.cat([
            bins.flatten(1),
            missing,
            *(
                embedding(categories[:, k].clamp(0, CATEGORIES - 1))
                for k, embedding in enumerate(self.categories)),
            photo.flatten(1),
            no_photo.flatten(1),
        ], 1).to(text.dtype))

        return torch.cat([
            self.head(torch.cat([text, table], 1)),
            self.mimic(text),
        ], 1)


def to_score(logits: torch.Tensor) -> torch.Tensor:
    return (
        logits[:, :len(LABELS)].softmax(1)[:, POSITIVE]
        * logits[:, len(LABELS)].sigmoid())


class Score(nn.Module):
    def __init__(self, net: Net) -> None:
        super().__init__()
        self.net = net

    def forward(
        self,
        input_ids: torch.Tensor,
        numbers: torch.Tensor,
        categories: torch.Tensor,
        photos: torch.Tensor,
    ) -> torch.Tensor:
        return to_score(self.net(
            input_ids, torch.ones_like(input_ids), numbers, categories, photos))


def batch(data: Data, rows: npt.NDArray[np.int64]) -> tuple[torch.Tensor, ...]:
    ids = [
        encoding.ids for encoding in introscore.TOKENIZER.encode_batch(
            [data.bodies[i] for i in rows])]
    width = max(map(len, ids))
    return (
        torch.tensor([i + [0] * (width - len(i)) for i in ids]).cuda(),
        torch.tensor(
            [[1] * len(i) + [0] * (width - len(i)) for i in ids]).cuda(),
        torch.tensor(data.numbers[rows]).cuda(),
        torch.tensor(data.categories[rows]).cuda(),
        torch.tensor(data.photos[rows]).cuda(),
    )


def descend(
    groups: list[tuple[list[nn.Parameter], float]],
    rows: npt.NDArray[np.int64],
    loss: Callable[[npt.NDArray[np.int64]], torch.Tensor],
) -> None:
    optimizer = torch.optim.AdamW(
        [dict(params=parameters, lr=rate) for parameters, rate in groups],
        weight_decay=WEIGHT_DECAY)
    steps = EPOCHS * -(-len(rows) // BATCH)
    schedule = get_linear_schedule_with_warmup(
        optimizer, int(0.05 * steps), steps)
    scaler = torch.amp.GradScaler()
    rng = np.random.default_rng(0)
    for _ in range(EPOCHS):
        order = rng.permutation(rows)
        for k in range(0, len(order), BATCH):
            with torch.autocast('cuda'):
                batch_loss = loss(order[k:k + BATCH])
            optimizer.zero_grad()
            scaler.scale(batch_loss).backward()
            scaler.unscale_(optimizer)
            nn.utils.clip_grad_norm_(
                [p for parameters, _ in groups for p in parameters], 1.0)
            scaler.step(optimizer)
            scaler.update()
            schedule.step()


def claim_gpu(gpus: 'multiprocessing.Queue[int]') -> None:
    torch.cuda.set_device(gpus.get())


def teach_fold(
    bodies: list[str],
    label: npt.NDArray[np.int64],
    held_out: npt.NDArray[np.bool_],
) -> npt.NDArray[np.float32]:
    tokenizer = AutoTokenizer.from_pretrained(TEACHER)
    net = AutoModelForSequenceClassification.from_pretrained(
        TEACHER, num_labels=len(LABELS)).cuda()
    net.gradient_checkpointing_enable()
    net.train()
    target = torch.tensor(label).cuda()

    def logits(rows: npt.NDArray[np.int64]) -> torch.Tensor:
        return net(**tokenizer(
            [bodies[i] for i in rows],
            padding=True,
            truncation=True,
            max_length=introscore.MAX_TOKENS,
            return_tensors='pt',
        ).to('cuda')).logits.float()

    descend(
        [(list(net.parameters()), TEACHER_LEARNING_RATE)],
        np.flatnonzero(~held_out),
        lambda rows: nn.functional.cross_entropy(
            logits(rows), target[torch.tensor(rows)]))

    net.eval()
    rows = np.flatnonzero(held_out)
    with torch.inference_mode(), torch.autocast('cuda'):
        return torch.cat([
            logits(rows[k:k + 256]).cpu()
            for k in range(0, len(rows), 256)]).numpy()


def teach(data: Data, rows: npt.NDArray[np.int64]) -> npt.NDArray[np.float32]:
    labelled = rows[data.label[rows] >= 0]
    fold = np.arange(len(labelled)) % TEACHER_FOLDS
    context = multiprocessing.get_context('spawn')
    gpus = context.Queue()
    for gpu in range(torch.cuda.device_count()):
        gpus.put(gpu)

    targets = np.zeros((len(data.label), len(LABELS)), np.float32)
    with ProcessPoolExecutor(
        torch.cuda.device_count(),
        mp_context=context,
        initializer=claim_gpu,
        initargs=(gpus,),
    ) as pool:
        results = pool.map(
            teach_fold,
            repeat([data.bodies[i] for i in labelled]),
            repeat(data.label[labelled]),
            [fold == k for k in range(TEACHER_FOLDS)])
        for k, result in enumerate(results):
            targets[labelled[fold == k]] = result
    targets[labelled] = (
        targets[labelled] - targets[labelled].mean(0)
    ) / targets[labelled].std(0)
    return targets


def fit(data: Data, rows: npt.NDArray[np.int64]) -> Net:
    torch.manual_seed(0)
    teacher = torch.tensor(teach(data, rows)).cuda()
    label = torch.tensor(data.label).cuda()
    replied = torch.tensor(data.replied, dtype=torch.float32).cuda()
    net = Net(torch.tensor(data.numbers[rows])).cuda()
    encoder = list(net.encoder.parameters())

    def loss(b: npt.NDArray[np.int64]) -> torch.Tensor:
        logits = net(*batch(data, b)).float()
        i = torch.tensor(b).cuda()
        labelled = label[i] >= 0
        return (
            (
                (
                    nn.functional.cross_entropy(
                        logits[:, :len(LABELS)],
                        label[i].clamp(min=0),
                        reduction='none')
                    + (logits[:, len(LABELS) + 1:] - teacher[i]).square().mean(1)
                ) * labelled
            ).sum() / labelled.sum().clamp(min=1)
            + REPLY_WEIGHT * nn.functional.binary_cross_entropy_with_logits(
                logits[:, len(LABELS)], replied[i]))

    net.train()
    descend(
        [
            (encoder, ENCODER_LEARNING_RATE),
            (
                [p for p in net.parameters()
                 if all(p is not e for e in encoder)],
                LEARNING_RATE),
        ],
        rows,
        loss)
    return net.eval()


def predict(net: Net, data: Data, rows: npt.NDArray[np.int64]) -> npt.NDArray[np.float32]:
    scores = np.zeros(len(data.label), np.float32)
    order = rows[np.argsort([len(data.bodies[i]) for i in rows])]
    with torch.inference_mode(), torch.autocast('cuda'):
        for k in range(0, len(order), 256):
            b = order[k:k + 256]
            scores[b] = to_score(net(*batch(data, b)).float()).cpu().numpy()
    return scores[rows]


def sort_quality(
    scores: npt.NDArray[np.float32],
    positive: npt.NDArray[np.bool_],
    recipient_id: npt.NDArray[np.int64],
) -> float:
    ordered = 0.0
    pairs = 0
    for recipient in np.unique(recipient_id[positive]):
        inbox = recipient_id == recipient
        good = scores[inbox & positive][:, None]
        rest = scores[inbox & ~positive][None, :]
        ordered += (good > rest).sum() + 0.5 * (good == rest).sum()
        pairs += good.size * rest.size
    return ordered / pairs


def export(net: Net, data: Data) -> None:
    full_precision = introscore.MODEL.with_suffix('.fp32.onnx')
    input_ids, _, *rest = batch(data, np.arange(2))
    torch.onnx.export(
        Score(net).float().cpu(),
        tuple(x.cpu() for x in (input_ids, *rest)),
        full_precision,
        input_names=['input_ids', 'numbers', 'categories', 'photos'],
        output_names=['score'],
        dynamic_axes=dict(
            input_ids={0: 'batch', 1: 'tokens'},
            numbers={0: 'batch'},
            categories={0: 'batch'},
            photos={0: 'batch'}),
        opset_version=17,
        dynamo=False)
    quantize_dynamic(
        full_precision, introscore.MODEL, weight_type=QuantType.QInt8)
    full_precision.unlink()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('labels', type=Path)
    parser.add_argument('--dsn', default='postgresql://postgres:password@localhost:5432/duo_api')
    parser.add_argument('--evaluate', action='store_true')
    args = parser.parse_args()

    data = load(args.dsn, load_labels(args.labels))
    held_out = args.evaluate & (data.recipient_id % HELD_OUT_RECIPIENTS == 0)
    net = fit(data, np.flatnonzero(~held_out))

    if args.evaluate:
        rows = np.flatnonzero(held_out & ((data.label >= 0) | ~data.replied))
        print(f'Sort quality: {sort_quality(
            predict(net, data, rows),
            data.label[rows] == POSITIVE,
            data.recipient_id[rows]):.3f}')
        return

    export(net, data)
    print('wrote', introscore.MODEL)


if __name__ == '__main__':
    main()
