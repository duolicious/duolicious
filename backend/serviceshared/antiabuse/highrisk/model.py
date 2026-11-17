import json
from collections.abc import Sequence
from functools import cache
from pathlib import Path

import numpy as np
import numpy.typing as npt

from serviceshared.antiabuse.highrisk.features import Example, ngrams

_PATH = Path(__file__).parent / 'model.npz'

Arrays = dict[str, npt.NDArray[np.float32]]

CLIP_WIDTH = 768

PHOTOS_WIDTH = 2 * CLIP_WIDTH + 1

COUNTRIES = ('profile_country', 'ip_country')


def numbers(
    examples: Sequence[Example],
    meta: dict[str, list[str]],
    stats: Arrays,
) -> npt.NDArray[np.float32]:
    raw = np.array([
        [e.numbers[c] for c in meta['numbers']] for e in examples
    ], np.float32).reshape(len(examples), len(meta['numbers']))
    for name in meta['percentiles']:
        column = meta['numbers'].index(name)
        known = stats[f'known.{name}']
        ranks = (
            np.searchsorted(known, raw[:, column], 'left')
            + np.searchsorted(known, raw[:, column], 'right')
        ) / 2 / len(known)
        raw[:, column] = np.where(np.isnan(raw[:, column]), np.nan, ranks)
    return raw


def tabular(
    examples: Sequence[Example],
    meta: dict[str, list[str]],
    stats: Arrays,
) -> npt.NDArray[np.float32]:
    raw = numbers(examples, meta, stats)
    missing = np.isnan(raw[:, stats['has_missing'].astype(bool)])
    raw = np.where(np.isnan(raw), stats['median'], raw)
    scaled = np.clip((raw - stats['mean']) / stats['std'], -5, 5)
    return np.hstack([scaled, missing.astype(np.float32)])


def photos(examples: Sequence[Example]) -> npt.NDArray[np.float32]:
    return np.array([
        np.zeros(PHOTOS_WIDTH) if e.photos is None
        else np.append(e.photos.reshape(-1), 1)
        for e in examples
    ], np.float32)


def countries(
    examples: Sequence[Example],
    meta: dict[str, list[str]],
) -> npt.NDArray[np.int64]:
    index = {country: i + 1 for i, country in enumerate(meta['countries'])}
    return np.array([
        [index.get(e.texts[field], 0) for field in COUNTRIES]
        for e in examples
    ], np.int64).reshape(len(examples), len(COUNTRIES))


def _bag(table: npt.NDArray[np.float32], texts: Sequence[str]) -> npt.NDArray[np.float32]:
    out = np.zeros((len(texts), table.shape[1]), np.float32)
    for i, text in enumerate(texts):
        ix = ngrams(text, table.shape[0]) if text else np.zeros(0, np.int64)
        if len(ix):
            out[i] = table[ix].mean(axis=0)
    return out


def _relu(x: npt.NDArray[np.float32]) -> npt.NDArray[np.float32]:
    return np.maximum(x, 0)


def _linear(w: Arrays, name: str, x: npt.NDArray[np.float32]) -> npt.NDArray[np.float32]:
    return x @ w[f'{name}.weight'].T + w[f'{name}.bias']


@cache
def _load() -> tuple[dict[str, list[str]], Arrays]:
    with np.load(_PATH) as f:
        arrays = {k: f[k].astype(np.float32) for k in f.files if k != 'meta'}
        meta = json.loads(str(f['meta']))
    return meta, arrays


def score(examples: Sequence[Example]) -> npt.NDArray[np.float32]:
    if not examples:
        return np.zeros(0, np.float32)
    meta, w = _load()
    tab = _linear(w, 'tab.3', _relu(_linear(
        w, 'tab.0', tabular(examples, meta, w))))
    clip = _linear(w, 'clip.1', photos(examples))
    vectors = [
        _linear(w, f'vectors.{name}.1', np.stack([
            e.vectors[name] for e in examples]))
        for name in meta['vectors']
    ]
    bags = [
        _bag(w[f'bags.{name}.weight'], [e.texts[name] for e in examples])
        for name in meta['texts']
    ]
    profile_country, ip_country = w['countries.weight'][
        countries(examples, meta)].transpose(1, 0, 2)
    hidden = _relu(np.hstack([
        tab, clip, *vectors, *bags, profile_country, ip_country]))
    hidden = _relu(_linear(w, 'head.1', np.hstack([
        hidden, (profile_country * ip_country).sum(1, keepdims=True)])))
    logits = _linear(w, 'head.4', hidden)[:, 0]
    return (1 / (1 + np.exp(-logits))).astype(np.float32)
