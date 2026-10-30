from io import BytesIO
from pathlib import Path

import numpy as np

from serviceshared.antiabuse.clipnsfw import embed, load_weights

_DIR = Path(__file__).parent

_WEIGHTS = load_weights(_DIR / 'model.safetensors')

_PROBE = np.load(_DIR / 'probe.npz')


def predict_clip_nsfw(image_data_list: list[BytesIO]) -> list[float]:
    return [
        float(1 / (1 + np.exp(-(
            embed(_WEIGHTS, image_data) @ _PROBE['weights'] + _PROBE['bias']))))
        for image_data in image_data_list
    ]
