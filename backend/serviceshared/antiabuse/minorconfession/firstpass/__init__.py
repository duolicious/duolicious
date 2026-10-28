from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

from serviceshared.duoenv.shared import OMP_NUM_THREADS

_DIR = Path(__file__).parent

_THRESHOLD = -4.93

_TOKENIZER = Tokenizer.from_file(str(_DIR / 'tokenizer.json'))

_SESSION_OPTIONS = ort.SessionOptions()
_SESSION_OPTIONS.intra_op_num_threads = OMP_NUM_THREADS
_SESSION_OPTIONS.inter_op_num_threads = 1
_SESSION_OPTIONS.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
_SESSION_OPTIONS.add_session_config_entry(
    'session.intra_op.allow_spinning', '0')

_SESSION = ort.InferenceSession(str(_DIR / 'model.onnx'), _SESSION_OPTIONS)


def may_confess_minor(message: str) -> bool:
    encoding = _TOKENIZER.encode(message)

    return any(
        _SESSION.run(None, {'input_ids': np.array([window.ids])})[0][0] > _THRESHOLD
        for window in [encoding, *encoding.overflowing])
