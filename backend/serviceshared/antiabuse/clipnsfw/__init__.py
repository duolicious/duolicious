from io import BytesIO

import numpy as np
import numpy.typing as npt
import onnxruntime as ort
from PIL import Image

_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)


def _pixels(image_data: BytesIO) -> npt.NDArray[np.float32]:
    image = Image.open(image_data).convert('RGB')
    short = min(image.size)
    width, height = 224 * image.width // short, 224 * image.height // short
    left, top = round((width - 224) / 2), round((height - 224) / 2)
    cropped = image.resize((width, height), Image.BICUBIC).crop(
        (left, top, left + 224, top + 224))
    pixels: npt.NDArray[np.float32] = (
        (np.asarray(cropped, dtype=np.float32) / np.float32(255) - _MEAN) / _STD)
    return pixels.transpose(2, 0, 1)


def embed(
    session: ort.InferenceSession,
    image_data: BytesIO,
) -> npt.NDArray[np.float32]:
    embedding: npt.NDArray[np.float32] = session.run(
        None, {'pixels': _pixels(image_data)})[0][0]
    return embedding
