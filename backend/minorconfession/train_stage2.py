import argparse
import math
import random
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import onnx
from onnx.external_data_helper import set_external_data
from onnxruntime.quantization import QuantType, quantize_dynamic
from sklearn.metrics import average_precision_score
import torch
import torch.nn.functional as F
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    PreTrainedModel,
    PreTrainedTokenizerFast,
)

from minorconfession.data import TARGETS, Item, load
from serviceshared.antiabuse.minorconfession.encoding import encode

SERVING_DIR = (
    Path(__file__).parent.parent /
    'serviceshared' / 'antiabuse' / 'minorconfession' / 'stage2')


def input_ids(tokenizer: PreTrainedTokenizerFast, item: Item) -> list[int]:
    return encode(
        tokenizer.backend_tokenizer,
        item.claimed_age,
        item.about,
        item.before,
        item.message)


def batches(
    examples: list[tuple[list[int], float]],
    size: int,
    pad: int,
) -> Iterator[tuple[torch.Tensor, torch.Tensor, torch.Tensor]]:
    for i in range(0, len(examples), size):
        chunk = examples[i:i + size]
        n = max(len(ids) for ids, _ in chunk)
        yield (
            torch.tensor([ids + [pad] * (n - len(ids)) for ids, _ in chunk]).cuda(),
            torch.tensor([[1] * len(ids) + [0] * (n - len(ids)) for ids, _ in chunk]).cuda(),
            torch.tensor([target for _, target in chunk]).cuda())


def logits(
    model: PreTrainedModel,
    tokenizer: PreTrainedTokenizerFast,
    items: list[Item],
    bf16: bool,
) -> list[float]:
    model.eval()
    result: list[float] = []
    examples = [(input_ids(tokenizer, item), 0.0) for item in items]
    with torch.no_grad(), torch.autocast('cuda', dtype=torch.bfloat16, enabled=bf16):
        for ids, mask, _ in batches(examples, 64, tokenizer.pad_token_id):
            result += model(input_ids=ids, attention_mask=mask).logits.squeeze(-1).float().cpu().tolist()
    model.train()
    return result


def teacher_targets(teachers: list[Path], items: list[Item]) -> list[float]:
    probabilities = torch.stack([
        torch.tensor(logits(
            AutoModelForSequenceClassification.from_pretrained(teacher).cuda(),
            AutoTokenizer.from_pretrained(teacher),
            items,
            bf16=True)).sigmoid()
        for teacher in teachers])
    labels = torch.tensor([TARGETS[item.label] for item in items])
    return ((labels + probabilities.mean(0)) / 2).tolist()


def fit(
    base: str,
    tokenizer: PreTrainedTokenizerFast,
    train: list[tuple[list[int], float]],
    val: list[Item],
    epochs: int,
    learning_rate: float,
    batch_size: int,
    accumulation: int,
    bf16: bool,
) -> PreTrainedModel:
    model = AutoModelForSequenceClassification.from_pretrained(
        base, num_labels=1, dtype=torch.float32).cuda()
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=learning_rate, weight_decay=0.01)
    steps = epochs * math.ceil(len(train) / batch_size / accumulation)
    schedule = torch.optim.lr_scheduler.LambdaLR(
        optimizer,
        lambda s: min(1.0, s / (0.06 * steps)) * max(0.0, (steps - s) / steps))
    val_yes = [item.label == 'yes' for item in val]
    best_ap, best_state = -1.0, model.state_dict()

    model.train()
    step = 0
    for epoch in range(epochs):
        random.shuffle(train)
        for ids, mask, target in batches(train, batch_size, tokenizer.pad_token_id):
            with torch.autocast('cuda', dtype=torch.bfloat16, enabled=bf16):
                output = model(input_ids=ids, attention_mask=mask).logits.squeeze(-1)
            loss = F.binary_cross_entropy_with_logits(output.float(), target)
            (loss / accumulation).backward()
            step += 1
            if step % accumulation:
                continue
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            schedule.step()
            optimizer.zero_grad()

        ap = average_precision_score(val_yes, logits(model, tokenizer, val, bf16))
        print(f'epoch {epoch} validation AP {ap:.3f}', flush=True)
        if ap > best_ap:
            best_ap = ap
            best_state = {
                k: v.detach().cpu().clone()
                for k, v in model.state_dict().items()}

    model.load_state_dict(best_state)
    return model.eval()


class Logits(torch.nn.Module):
    def __init__(self, model: PreTrainedModel) -> None:
        super().__init__()
        self.model = model

    def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
        return self.model(input_ids=input_ids).logits


def export(
    model: PreTrainedModel,
    tokenizer: PreTrainedTokenizerFast,
    out: Path,
) -> None:
    torch.onnx.export(
        Logits(model.cpu()),
        (torch.ones((1, 32), dtype=torch.long),),
        out / 'model.fp32.onnx',
        input_names=['input_ids'],
        output_names=['logits'],
        dynamic_axes={'input_ids': {1: 'tokens'}},
        opset_version=17,
        dynamo=False)
    quantize_dynamic(
        out / 'model.fp32.onnx',
        out / 'model.int8.onnx',
        weight_type=QuantType.QInt8)

    quantized = onnx.load(out / 'model.int8.onnx')
    sizes = dict.fromkeys(['model.onnx.data0', 'model.onnx.data1'], 0)
    for name in sizes:
        (SERVING_DIR / name).unlink(missing_ok=True)
    for tensor in sorted(
            (t for t in quantized.graph.initializer if len(t.raw_data) > 1024),
            key=lambda t: -len(t.raw_data)):
        name = min(sizes, key=lambda n: sizes[n])
        set_external_data(tensor, location=name)
        sizes[name] += len(tensor.raw_data)
    onnx.save_model(quantized, SERVING_DIR / 'model.onnx')
    tokenizer.backend_tokenizer.save(str(SERVING_DIR / 'tokenizer.json'))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('data', type=Path)
    parser.add_argument('out', type=Path)
    parser.add_argument('--base', default='roberta-base')
    parser.add_argument('--seed', type=int, default=1)
    parser.add_argument('--lr', type=float, default=2e-5)
    parser.add_argument('--epochs', type=int, default=4)
    parser.add_argument('--batch', type=int, default=16)
    parser.add_argument('--accum', type=int, default=1)
    parser.add_argument('--bf16', action='store_true')
    parser.add_argument('--teachers', type=Path, nargs='+', default=[])
    parser.add_argument('--serve', action='store_true')
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    items = load(args.data)
    train = [item for item in items if item.split == 'train' and not item.is_benchmark]
    val = [item for item in items if item.split == 'val' and not item.is_benchmark]
    targets = (
        teacher_targets(args.teachers, train) if args.teachers
        else [TARGETS[item.label] for item in train])

    tokenizer = AutoTokenizer.from_pretrained(args.base)
    model = fit(
        args.base,
        tokenizer,
        [(input_ids(tokenizer, item), t) for item, t in zip(train, targets)],
        val,
        epochs=args.epochs,
        learning_rate=args.lr,
        batch_size=args.batch,
        accumulation=args.accum,
        bf16=args.bf16)

    model.save_pretrained(args.out)
    tokenizer.save_pretrained(args.out)
    if args.serve:
        export(model, tokenizer, args.out)


if __name__ == '__main__':
    main()
