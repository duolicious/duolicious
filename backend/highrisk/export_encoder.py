from pathlib import Path

import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoModel, AutoTokenizer

BASE = 'sentence-transformers/all-MiniLM-L6-v2'
SERVING_DIR = (
    Path(__file__).parents[1] / 'serviceshared/antiabuse/highrisk')
MAX_TOKENS = 256


class Embed(torch.nn.Module):
    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
        hidden = self.model(input_ids=input_ids).last_hidden_state
        return torch.nn.functional.normalize(hidden.mean(1), dim=-1)


def main() -> None:
    tokenizer = AutoTokenizer.from_pretrained(BASE).backend_tokenizer
    tokenizer.no_padding()
    tokenizer.enable_truncation(max_length=MAX_TOKENS)
    tokenizer.save(str(SERVING_DIR / 'tokenizer.json'))

    full_precision = SERVING_DIR / 'encoder.fp32.onnx'
    torch.onnx.export(
        Embed(AutoModel.from_pretrained(BASE).eval()),
        (torch.ones((1, 32), dtype=torch.long),),
        full_precision,
        input_names=['input_ids'],
        output_names=['embedding'],
        dynamic_axes={'input_ids': {0: 'batch', 1: 'tokens'}},
        opset_version=17,
        dynamo=False)
    quantize_dynamic(
        full_precision,
        SERVING_DIR / 'encoder.onnx',
        weight_type=QuantType.QInt8)
    full_precision.unlink()


if __name__ == '__main__':
    main()
