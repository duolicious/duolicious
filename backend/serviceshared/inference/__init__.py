import numpy as np
import onnxruntime as ort
from tokenizers import Encoding

from serviceshared.duoenv.shared import OMP_NUM_THREADS


def onnx_session(model: str | bytes) -> ort.InferenceSession:
    options = ort.SessionOptions()
    options.intra_op_num_threads = OMP_NUM_THREADS
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.add_session_config_entry('session.intra_op.allow_spinning', '0')

    return ort.InferenceSession(model, options)


def any_window_above(
    session: ort.InferenceSession,
    encoding: Encoding,
    threshold: float,
) -> bool:
    return any(
        session.run(None, {'input_ids': np.array([window.ids])})[0][0] > threshold
        for window in [encoding, *encoding.overflowing])
