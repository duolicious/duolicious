import json
import math
import os
import random
from pathlib import Path

import numpy as np
import psycopg
import torch
import torch.nn.functional as F
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    PreTrainedModel,
    PreTrainedTokenizerFast,
    get_linear_schedule_with_warmup,
)

from serviceshared.antiabuse.normalize import normalize_chat_message

DIR = Path(__file__).parent

SERVING_DIR = DIR.parent / 'serviceshared' / 'antiabuse' / 'antirude' / 'chat'

MAX_TOKENS = 128

Q_INTROS = """
WITH recent AS (
    SELECT person_id, remote_bare_jid, id, body
    FROM mam_message
    WHERE direction = 'O'
    AND audio_uuid IS NULL
    AND length(body) BETWEEN 1 AND 600
    AND get_byte(decode(md5('rude-' || person_id), 'hex'), 0) >= 77
)
SELECT body
FROM recent
WHERE NOT EXISTS (
    SELECT 1
    FROM mam_message AS reply
    WHERE reply.person_id = recent.person_id
    AND reply.remote_bare_jid = recent.remote_bare_jid
    AND reply.direction = 'I'
    AND reply.id < recent.id
)
UNION
SELECT message
FROM rude_message
WHERE length(message) BETWEEN 1 AND 600
AND get_byte(decode(md5('rude-' || person_id), 'hex'), 0) >= 77
"""


def fit(
    base: str,
    texts: list[str],
    targets: list[float],
    epochs: int,
    learning_rate: float,
    batch_size: int,
) -> tuple[PreTrainedModel, PreTrainedTokenizerFast]:
    tokenizer = AutoTokenizer.from_pretrained(base)
    model = AutoModelForSequenceClassification.from_pretrained(
        base, num_labels=2).cuda()
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
    steps = epochs * math.ceil(len(texts) / batch_size)
    schedule = get_linear_schedule_with_warmup(
        optimizer, steps // 16, steps)
    examples = list(zip(texts, targets))

    model.train()
    for _ in range(epochs):
        random.shuffle(examples)
        for i in range(0, len(examples), batch_size):
            batch = examples[i:i + batch_size]
            inputs = tokenizer(
                [text for text, _ in batch],
                truncation=True,
                max_length=MAX_TOKENS,
                padding=True,
                return_tensors='pt').to('cuda')
            target = torch.tensor([t for _, t in batch], device='cuda')
            with torch.autocast('cuda', dtype=torch.bfloat16):
                logits = model(**inputs).logits.float()
            loss = -(
                torch.stack([1 - target, target], dim=1) *
                F.log_softmax(logits, dim=1)).sum(dim=1).mean()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            schedule.step()
            optimizer.zero_grad()

    return model.eval(), tokenizer


def probabilities(
    model: PreTrainedModel,
    tokenizer: PreTrainedTokenizerFast,
    texts: list[str],
) -> list[float]:
    order = sorted(range(len(texts)), key=lambda i: len(texts[i]))
    result = [0.0] * len(texts)
    with torch.no_grad():
        for i in range(0, len(order), 512):
            batch = order[i:i + 512]
            inputs = tokenizer(
                [texts[j] for j in batch],
                truncation=True,
                max_length=MAX_TOKENS,
                padding=True,
                return_tensors='pt').to('cuda')
            with torch.autocast('cuda', dtype=torch.bfloat16):
                logits = model(**inputs).logits.float()
            for j, p in zip(batch, logits.softmax(dim=1)[:, 1].tolist()):
                result[j] = p
    return result


def teacher_probabilities(
    seed: int,
    texts: list[str],
    targets: list[float],
    intros: list[str],
) -> list[float]:
    random.seed(seed)
    torch.manual_seed(seed)
    teacher, tokenizer = fit(
        'cardiffnlp/twitter-roberta-large-2022-154m',
        texts,
        targets,
        epochs=4,
        learning_rate=1.5e-5,
        batch_size=16)
    result = probabilities(teacher, tokenizer, intros)
    del teacher
    torch.cuda.empty_cache()
    return result


class Score(torch.nn.Module):
    def __init__(self, model: PreTrainedModel) -> None:
        super().__init__()
        self.model = model

    def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
        logits = self.model(input_ids=input_ids).logits
        return logits[:, 1] - logits[:, 0]


def export(model: PreTrainedModel, tokenizer: PreTrainedTokenizerFast) -> None:
    torch.onnx.export(
        Score(model.cpu()),
        (torch.tensor([tokenizer('hello').input_ids]),),
        SERVING_DIR / 'model.onnx',
        input_names=['input_ids'],
        output_names=['score'],
        dynamic_axes={'input_ids': {0: 'batch', 1: 'tokens'}},
        dynamo=False)

    serving_tokenizer = tokenizer.backend_tokenizer
    serving_tokenizer.enable_truncation(max_length=MAX_TOKENS, stride=32)
    serving_tokenizer.save(str(SERVING_DIR / 'tokenizer.json'))


def main() -> None:
    random.seed(0)
    np.random.seed(0)
    torch.manual_seed(0)

    labelled = [
        json.loads(line)
        for name in ['train.jsonl', 'synthetic.jsonl']
        for line in (DIR / name).read_text().splitlines()]
    texts = [normalize_chat_message(e['text']) for e in labelled]
    targets = [float(e['rude']) for e in labelled]

    dsn = os.environ.get(
        'DUO_DB_DSN',
        'host=localhost port=5432 dbname=duo_api user=postgres password=password')
    with psycopg.connect(dsn) as conn:
        intros = [
            normalize_chat_message(body)
            for body, in conn.execute(Q_INTROS).fetchall()]

    intro_targets = np.mean([
        teacher_probabilities(seed, texts, targets, intros)
        for seed in range(3)
    ], axis=0).tolist()

    student, student_tokenizer = fit(
        'google/bert_uncased_L-4_H-256_A-4',
        texts + intros,
        targets + intro_targets,
        epochs=8,
        learning_rate=1e-4,
        batch_size=64)

    export(student, student_tokenizer)


if __name__ == '__main__':
    main()
