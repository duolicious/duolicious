import argparse
import csv
import math
import random
from pathlib import Path

import numpy as np
from onnxruntime.quantization import QuantType, quantize_dynamic
import torch
import torch.nn.functional as F
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    PreTrainedModel,
    PreTrainedTokenizerFast,
)

from minorconfession.train import TARGETS, load

SERVING_DIR = (
    Path(__file__).parent.parent /
    'serviceshared' / 'antiabuse' / 'minorconfession' / 'firstpass')

PASS_RATE = 0.024


def logits(
    model: PreTrainedModel,
    tokenizer: PreTrainedTokenizerFast,
    messages: list[str],
) -> np.ndarray:
    model.eval()
    order = sorted(range(len(messages)), key=lambda i: len(messages[i]))
    result = np.zeros(len(messages))
    with torch.no_grad(), torch.autocast('cuda', dtype=torch.bfloat16):
        for k in range(0, len(order), 512):
            chunk = order[k:k + 512]
            inputs = tokenizer(
                [messages[i] for i in chunk],
                truncation=True,
                max_length=128,
                padding=True,
                return_tensors='pt').to('cuda')
            result[chunk] = model(**inputs).logits.squeeze(-1).float().cpu().numpy()
    model.train()
    return result


class Logit(torch.nn.Module):
    def __init__(self, model: PreTrainedModel) -> None:
        super().__init__()
        self.model = model

    def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
        return self.model(input_ids=input_ids).logits[:, 0]


def export(
    model: PreTrainedModel,
    tokenizer: PreTrainedTokenizerFast,
    out: Path,
) -> None:
    torch.onnx.export(
        Logit(model.cpu()),
        (torch.ones((1, 32), dtype=torch.long),),
        out / 'model.fp32.onnx',
        input_names=['input_ids'],
        output_names=['logit'],
        dynamic_axes={'input_ids': {0: 'batch', 1: 'tokens'}},
        opset_version=17,
        dynamo=False)
    quantize_dynamic(
        out / 'model.fp32.onnx',
        SERVING_DIR / 'model.onnx',
        weight_type=QuantType.QInt8)
    tokenizer.backend_tokenizer.enable_truncation(max_length=128, stride=32)
    tokenizer.backend_tokenizer.save(str(SERVING_DIR / 'tokenizer.json'))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('data', type=Path)
    parser.add_argument('negatives', type=Path)
    parser.add_argument('out', type=Path)
    parser.add_argument('--base', default='google/bert_uncased_L-4_H-256_A-4')
    parser.add_argument('--seed', type=int, default=1)
    parser.add_argument('--lr', type=float, default=5e-5)
    parser.add_argument('--epochs', type=int, default=2)
    parser.add_argument('--batch', type=int, default=64)
    parser.add_argument('--oversample', type=int, default=10)
    parser.add_argument('--serve', action='store_true')
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    items = load(args.data)
    confessions = {
        ' '.join(item.message.lower().split())
        for item in items if item.label != 'no'}
    with args.negatives.open(newline='') as f:
        negatives = [row[0] for row in csv.reader(f)]
    held = negatives[::5][:40000]
    pool = [
        message for i, message in enumerate(negatives)
        if i % 5 and ' '.join(message.lower().split()) not in confessions]
    random.shuffle(pool)

    train = [
        (item.message, TARGETS[item.label])
        for item in items
        if item.split == 'train' and not item.is_live and item.label != 'no']
    examples = train * args.oversample + [(m, 0.0) for m in pool[:300000]]
    val = [item for item in items if item.split == 'val' and not item.is_live]

    tokenizer = AutoTokenizer.from_pretrained(args.base)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.base, num_labels=1).cuda()
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.lr, weight_decay=0.01)
    steps = args.epochs * math.ceil(len(examples) / args.batch)
    schedule = torch.optim.lr_scheduler.LambdaLR(
        optimizer,
        lambda s: min(1.0, s / (0.06 * steps)) * max(0.0, (steps - s) / steps))
    marks = {math.ceil(len(examples) / args.batch * j / 4) for j in range(1, 5)}
    best, best_state = -1.0, model.state_dict()

    model.train()
    for epoch in range(args.epochs):
        random.shuffle(examples)
        for n, k in enumerate(range(0, len(examples), args.batch), 1):
            chunk = examples[k:k + args.batch]
            inputs = tokenizer(
                [message for message, _ in chunk],
                truncation=True,
                max_length=128,
                padding=True,
                return_tensors='pt').to('cuda')
            with torch.autocast('cuda', dtype=torch.bfloat16):
                output = model(**inputs).logits.squeeze(-1).float()
            loss = F.binary_cross_entropy_with_logits(
                output, torch.tensor([t for _, t in chunk], device='cuda'))
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            schedule.step()
            optimizer.zero_grad()
            if n not in marks:
                continue

            threshold = np.quantile(logits(model, tokenizer, held), 1 - PASS_RATE)
            passed = logits(model, tokenizer, [item.message for item in val]) > threshold
            recall = {
                label: passed[[item.label == label for item in val]].mean()
                for label in ('yes', 'maybe')}
            print(f"epoch {epoch} step {n} validation recall: yes {recall['yes']:.3f} maybe {recall['maybe']:.3f}", flush=True)
            if recall['yes'] + recall['maybe'] / 4 > best:
                best = recall['yes'] + recall['maybe'] / 4
                best_state = {
                    k: v.detach().cpu().clone()
                    for k, v in model.state_dict().items()}

    model.load_state_dict(best_state)
    model.save_pretrained(args.out)
    tokenizer.save_pretrained(args.out)
    if args.serve:
        export(model, tokenizer, args.out)


if __name__ == '__main__':
    main()
