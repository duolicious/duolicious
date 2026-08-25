"""The frozen weights and feature vocabulary the encoders were trained with."""
import os

import numpy as np
import numpy.typing as npt

from service.cron.kvvectors.encoder import Encoder

ARTIFACT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'kv_model.npz')


class Spec:
    def __init__(self, path: str = ARTIFACT) -> None:
        z = np.load(path, allow_pickle=False)
        weights = {k: z[k] for k in z.files if '.' in k}
        self.m = int(z['m'])
        self.qids: npt.NDArray[np.int64] = z['qids']
        self.cat_fields: list[str] = [str(x) for x in z['cat_fields']]
        self.cat_sizes: npt.NDArray[np.int64] = z['cat_sizes']
        self.countries: list[str] = [str(x) for x in z['countries']]
        self.clubs: list[str] = [str(x) for x in z['clubs']]
        self.pref_multi_fields: list[str] = [str(x) for x in z['pref_multi_fields']]
        self.pref_multi_sizes: npt.NDArray[np.int64] = z['pref_multi_sizes']
        self.pref_two_way_fields: list[str] = [str(x) for x in z['pref_two_way_fields']]
        self.loc_freqs: npt.NDArray[np.int64] = z['loc_freqs']
        self.who = Encoder(weights, 'who', self.m)
        self.look = Encoder(weights, 'look', self.m)

        self.qid_column = {int(q): i for i, q in enumerate(self.qids)}
        self.country_column = {c: i + 1 for i, c in enumerate(self.countries)}
        self.club_column = {c: i for i, c in enumerate(self.clubs)}
