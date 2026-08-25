"""The dense per-person blocks the encoders consume, in training's layout."""
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

IntArray = npt.NDArray[np.int64]
FloatArray = npt.NDArray[np.float32]
F64Array = npt.NDArray[np.float64]


@dataclass(frozen=True)
class Blocks:
    person_ids: IntArray
    age: F64Array
    height_cm: F64Array
    lat: F64Array
    lon: F64Array
    answers: FloatArray
    cats: list[IntArray]
    country: IntArray
    clubs: FloatArray
    pref_answers: FloatArray
    pref_multi: FloatArray
    pref_min_age: F64Array
    pref_max_age: F64Array
    pref_min_height_cm: F64Array
    pref_max_height_cm: F64Array
    pref_distance: F64Array
    pref_last_online_id: IntArray
    pref_two_way: FloatArray

    def pref_numeric_columns(self) -> list[F64Array]:
        return [self.pref_min_age, self.pref_max_age,
                self.pref_min_height_cm, self.pref_max_height_cm]
