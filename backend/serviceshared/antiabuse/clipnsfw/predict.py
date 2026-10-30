from io import BytesIO
from pathlib import Path

import numpy as np

from serviceshared.antiabuse.clipnsfw import embed
from serviceshared.inference import onnx_session

_DIR = Path(__file__).parent

_SESSION = onnx_session(str(_DIR / 'vision_model.onnx'))

_PROBE = np.load(_DIR / 'probe.npz')


def predict_clip_nsfw(image_data_list: list[BytesIO]) -> list[float]:
    return [
        float(1 / (1 + np.exp(-(
            embed(_SESSION, image_data) @ _PROBE['weights'] + _PROBE['bias']))))
        for image_data in image_data_list
    ]
