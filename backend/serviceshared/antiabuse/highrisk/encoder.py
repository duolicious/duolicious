from collections.abc import Sequence
from functools import cache, lru_cache
from pathlib import Path

import numpy as np
import numpy.typing as npt
import onnxruntime as ort
from tokenizers import Tokenizer

from serviceshared.inference import onnx_session

_DIR = Path(__file__).parent

WIDTH = 384


@cache
def _model() -> tuple[Tokenizer, ort.InferenceSession]:
    return (
        Tokenizer.from_file(str(_DIR / 'tokenizer.json')),
        onnx_session(str(_DIR / 'encoder.onnx')),
    )


@lru_cache(maxsize=4096)
def _embed(text: str) -> npt.NDArray[np.float32]:
    tokenizer, session = _model()
    ids = np.array([tokenizer.encode(text).ids])
    return session.run(None, {'input_ids': ids})[0][0]


def embed(texts: Sequence[str]) -> npt.NDArray[np.float32]:
    vectors = [_embed(text) for text in texts if text.strip()]
    if not vectors:
        return np.zeros(WIDTH, np.float32)
    return np.mean(vectors, axis=0)
