from pathlib import Path

import numpy as np
from tokenizers import Tokenizer

from serviceshared.antiabuse.minorconfession.encoding import encode
from serviceshared.inference import onnx_session

_DIR = Path(__file__).parent

_THRESHOLD = -0.27

_TOKENIZER = Tokenizer.from_file(str(_DIR / 'tokenizer.json'))

_SESSION = onnx_session(str(_DIR / 'model.onnx'))


def is_minor_confession(
    claimed_age: int,
    about: str,
    before: list[tuple[bool, str]],
    target: str,
) -> bool:
    input_ids = encode(_TOKENIZER, claimed_age, about, before, target)

    return _SESSION.run(None, {'input_ids': np.array([input_ids])})[0][0][0] > _THRESHOLD
