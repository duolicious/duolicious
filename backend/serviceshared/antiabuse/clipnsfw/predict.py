from io import BytesIO
from pathlib import Path

import numpy as np
import numpy.typing as npt
from PIL import Image

from serviceshared.antiabuse.clipnsfw import embed
from serviceshared.inference import onnx_session

_DIR = Path(__file__).parent

_SESSION = onnx_session(str(_DIR / 'model.onnx'))

_PROBE = np.load(_DIR / 'probe.npz')


def embed_clip_nsfw(image_data: BytesIO) -> npt.NDArray[np.float32] | None:
    try:
        return embed(_SESSION, image_data)
    except (OSError, Image.DecompressionBombError):
        return None


def _predict_one(
    image_data: BytesIO,
) -> tuple[float, npt.NDArray[np.float32] | None]:
    embedding = embed_clip_nsfw(image_data)

    if embedding is None:
        return -1.0, None

    return float(1 / (1 + np.exp(-(
        embedding @ _PROBE['weights'] + _PROBE['bias'])))), embedding


def predict_clip_nsfw(
    image_data_list: list[BytesIO],
) -> list[tuple[float, npt.NDArray[np.float32] | None]]:
    return [_predict_one(image_data) for image_data in image_data_list]
