from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

from serviceshared.antiabuse.clipnsfw import embed
from serviceshared.inference import onnx_session

_DIR = Path(__file__).parent

_SESSION = onnx_session(str(_DIR / 'model.onnx'))

_PROBE = np.load(_DIR / 'probe.npz')


def _predict_one(image_data: BytesIO) -> float:
    try:
        embedding = embed(_SESSION, image_data)
    except (OSError, Image.DecompressionBombError):
        return -1.0

    return float(1 / (1 + np.exp(-(
        embedding @ _PROBE['weights'] + _PROBE['bias']))))


def predict_clip_nsfw(image_data_list: list[BytesIO]) -> list[float]:
    return [_predict_one(image_data) for image_data in image_data_list]
