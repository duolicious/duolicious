import json
from io import BytesIO
from pathlib import Path

import numpy as np
import numpy.typing as npt
from PIL import Image

Weights = dict[str, npt.NDArray[np.float32]]

_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)


def load_weights(path: Path) -> Weights:
    with path.open('rb') as file:
        header_size = int.from_bytes(file.read(8), 'little')
        header = json.loads(file.read(header_size))

    return {
        name: np.fromfile(
            path,
            dtype='<f4',
            count=int(np.prod(tensor['shape'])),
            offset=8 + header_size + tensor['data_offsets'][0],
        ).reshape(tensor['shape'])
        for name, tensor in header.items()
        if name.startswith(('vision_model.', 'visual_projection.'))
        and tensor['dtype'] == 'F32'
    }


def _pixels(image_data: BytesIO) -> npt.NDArray[np.float32]:
    image = Image.open(image_data).convert('RGB')
    short = min(image.size)
    width, height = 224 * image.width // short, 224 * image.height // short
    left, top = round((width - 224) / 2), round((height - 224) / 2)
    cropped = image.resize((width, height), Image.BICUBIC).crop(
        (left, top, left + 224, top + 224))
    pixels = np.asarray(cropped, dtype=np.float32)
    return ((pixels / 255 - _MEAN) / _STD).transpose(2, 0, 1)


def _layer_norm(
    weights: Weights,
    name: str,
    x: npt.NDArray[np.float32],
) -> npt.NDArray[np.float32]:
    mean = x.mean(-1, keepdims=True)
    variance = ((x - mean) ** 2).mean(-1, keepdims=True)
    normalized = (x - mean) / np.sqrt(variance + 1e-5)
    return normalized * weights[f'{name}.weight'] + weights[f'{name}.bias']


def _linear(
    weights: Weights,
    name: str,
    x: npt.NDArray[np.float32],
) -> npt.NDArray[np.float32]:
    return x @ weights[f'{name}.weight'].T + weights[f'{name}.bias']


def embed(weights: Weights, image_data: BytesIO) -> npt.NDArray[np.float32]:
    patches = (
        _pixels(image_data)
        .reshape(3, 16, 14, 16, 14)
        .transpose(1, 3, 0, 2, 4)
        .reshape(256, 588))
    x = patches @ weights[
        'vision_model.embeddings.patch_embedding.weight'].reshape(1024, 588).T
    x = np.concatenate([
        weights['vision_model.embeddings.class_embedding'][None], x])
    x = x + weights['vision_model.embeddings.position_embedding.weight']
    x = _layer_norm(weights, 'vision_model.pre_layrnorm', x)

    for layer in range(24):
        name = f'vision_model.encoder.layers.{layer}'

        h = _layer_norm(weights, f'{name}.layer_norm1', x)
        q, k, v = (
            _linear(weights, f'{name}.self_attn.{p}_proj', h)
            .reshape(257, 16, 64)
            .transpose(1, 0, 2)
            for p in 'qkv')
        scores = q @ k.transpose(0, 2, 1) / 8
        scores = np.exp(scores - scores.max(-1, keepdims=True))
        attention = (scores / scores.sum(-1, keepdims=True)) @ v
        x = x + _linear(
            weights,
            f'{name}.self_attn.out_proj',
            attention.transpose(1, 0, 2).reshape(257, 1024))

        h = _linear(
            weights,
            f'{name}.mlp.fc1',
            _layer_norm(weights, f'{name}.layer_norm2', x))
        x = x + _linear(
            weights, f'{name}.mlp.fc2', h * (1 + np.tanh(0.851 * h)) / 2)

    embedding = _layer_norm(weights, 'vision_model.post_layernorm', x[0]) @ (
        weights['visual_projection.weight'].T)
    return embedding / np.linalg.norm(embedding)
