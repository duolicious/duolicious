import os

import numpy as np
import numpy.typing as npt
import pandas as pd
import torch

from kvmatching.paths import DATA
from serviceshared.kvmatching.blocks import F64Array, FloatArray, IntArray
from serviceshared.kvmatching.features import (
    behaviour_features,
    profile_quality_features,
)

Int8Array = npt.NDArray[np.int8]
Batch = dict[str, torch.Tensor]

CAT_FIELDS = [
    "gender_id", "orientation_id", "ethnicity_id", "looking_for_id",
    "smoking_id", "drinking_id", "drugs_id", "long_distance_id",
    "relationship_status_id", "has_kids_id", "wants_kids_id", "exercise_id",
    "religion_id", "star_sign_id",
]
PREF_MULTI = [
    "gender_ids", "orientation_ids", "ethnicity_ids", "has_profile_picture_ids",
    "looking_for_ids", "smoking_ids", "drinking_ids", "drugs_ids",
    "long_distance_ids", "relationship_status_ids", "has_kids_ids",
    "wants_kids_ids", "exercise_ids", "religion_ids", "star_sign_ids",
]
PREF_TWO_WAY = [
    "two_way_gender", "two_way_age", "two_way_furthest_distance",
    "two_way_orientation", "two_way_relationship_status", "two_way_looking_for",
    "two_way_wants_kids", "two_way_has_kids", "two_way_has_a_profile_picture",
    "two_way_drugs", "two_way_long_distance", "two_way_ethnicity",
    "two_way_smoking", "two_way_religion", "two_way_drinking", "two_way_height",
    "two_way_exercise", "two_way_star_sign",
]
N_COUNTRIES = 60
LOC_FREQS = [1, 2, 4, 8, 16, 32, 64]


def fourier_latlon(lat: F64Array, lon: F64Array) -> FloatArray:
    a = np.deg2rad(lat)[:, None]
    b = np.deg2rad(lon)[:, None]
    f = np.array(LOC_FREQS, dtype=np.float64)[None, :]
    feats = [np.sin(a * f), np.cos(a * f), np.sin(b * f), np.cos(b * f)]
    return np.concatenate(feats, axis=1).astype(np.float32)


class Features:
    """Dense per-person feature blocks, indexed by row (0..N-1). `pid2row`
    maps person ids to rows."""

    def __init__(self) -> None:
        people = pd.read_parquet(os.path.join(DATA, "people.parquet"))
        people = people.sort_values("id").reset_index(drop=True)
        self.people = people
        self.ids = people["id"].to_numpy()
        self.n = len(people)
        self.pid2row = pd.Series(np.arange(self.n), index=self.ids)

        questions = pd.read_parquet(os.path.join(DATA, "questions.parquet"))
        self.qids = questions["id"].to_numpy()
        self.nq = len(self.qids)
        qid2col = pd.Series(np.arange(self.nq), index=self.qids)
        self.questions = questions

        self.answers = self._load_pm1("answers.parquet", qid2col)
        self.cat_sizes, self.cat = self._cats()
        self.num, self.num_mask = self._nums()
        self.loc = fourier_latlon(
            people["lat"].to_numpy(float), people["lon"].to_numpy(float))
        self.country = self._country()

        prefs = self._prefs()
        self.pref_answers = self._load_pm1("pref_answers.parquet", qid2col)
        self.pref_multi_sizes, self.pref_multi = self._pref_multi(prefs)
        self.pref_num, self.pref_num_mask = self._pref_nums(prefs)
        self.pref_two_way = self._pref_two_way(prefs)

        self.personality = self._personality()
        self.beh = self._behaviour()
        self.prof = self._profile_quality()

    def _profile_quality(self) -> FloatArray:
        """The profile-quality block, through the serving side's own
        transform: verification level, bio traits, photo and club counts."""
        bio = pd.read_parquet(os.path.join(DATA, "bio.parquet"))
        bio = bio.set_index("person_id")["about"].reindex(self.ids)
        return profile_quality_features(
            self.people["verification_level_id"].fillna(1).to_numpy(np.int64),
            [t if isinstance(t, str) else None for t in bio.to_numpy()],
            self.people["photo_count"].to_numpy(np.int64),
            self.people["club_count"].to_numpy(np.int64),
        )

    def _behaviour(self) -> FloatArray:
        """The four pre-SPLIT behaviour counters (extracted with the serving
        side's own query) through the serving side's own transform."""
        c = pd.read_parquet(os.path.join(DATA, "beh_counts.parquet"))
        c = c.set_index("person_id").reindex(self.ids).fillna(0)
        return behaviour_features(
            c["count_intros_received"].to_numpy(np.int64),
            c["count_intros_replied"].to_numpy(np.int64),
            c["count_intros_sent"].to_numpy(np.int64),
            c["count_messages_received"].to_numpy(np.int64),
        )

    def _load_pm1(self, filename: str, qid2col: pd.Series) -> Int8Array:
        """A (person, question) parquet of booleans as a dense +1/-1/0 block."""
        a = pd.read_parquet(os.path.join(DATA, filename))
        rows = self.pid2row.reindex(a["person_id"].to_numpy()).to_numpy()
        cols = qid2col.reindex(a["question_id"].to_numpy()).to_numpy()
        ok = ~np.isnan(rows) & ~np.isnan(cols)
        m = np.zeros((self.n, self.nq), dtype=np.int8)
        v = np.where(a["answer"].to_numpy()[ok], 1, -1).astype(np.int8)
        m[rows[ok].astype(int), cols[ok].astype(int)] = v
        return m

    def _cats(self) -> tuple[list[int], IntArray]:
        sizes = []
        cols = []
        for f in CAT_FIELDS:
            v = self.people[f].fillna(1).to_numpy(int)
            sizes.append(int(v.max()) + 1)
            cols.append(v)
        return sizes, np.stack(cols, axis=1).astype(np.int64)

    def _nums(self) -> tuple[FloatArray, FloatArray]:
        # Year of birth rather than age: it never changes, so a person's
        # vector never goes stale just because time passed.
        year = np.clip(self.people["birth_year"].to_numpy(float), 1935, 2055)
        h = self.people["height_cm"].to_numpy(float)
        hm = ~np.isnan(h) & (h >= 120) & (h <= 230)
        h = np.where(hm, h, 170.0)
        num = np.stack([(year - 1995) / 10, (h - 170) / 10], axis=1)
        mask = np.stack([np.ones_like(hm), hm], axis=1)
        return num.astype(np.float32), mask.astype(np.float32)

    def _country(self) -> IntArray:
        c = self.people["country"].fillna("")
        top = c.value_counts().index[:N_COUNTRIES - 1]
        idx = pd.Series(np.arange(1, N_COUNTRIES), index=top)
        return idx.reindex(c).fillna(0).to_numpy().astype(np.int64)

    def _prefs(self) -> pd.DataFrame:
        p = pd.read_parquet(os.path.join(DATA, "prefs.parquet"))
        return p.set_index("person_id").reindex(self.ids)

    def _pref_multi(self, p: pd.DataFrame) -> tuple[list[int], list[Int8Array]]:
        sizes = []
        blocks = []
        for f in PREF_MULTI:
            # a person with no search_preference row reindexes to NaN floats
            lists = [x if isinstance(x, np.ndarray) else None
                     for x in p[f].to_numpy()]
            size = 1 + max(
                (int(max(x)) for x in lists if x is not None and len(x)), default=0)
            m = np.zeros((self.n, size), dtype=np.int8)
            for i, x in enumerate(lists):
                if x is None or len(x) == 0:
                    continue
                m[i, np.asarray(x, dtype=int)] = 1
            sizes.append(size)
            blocks.append(m)
        return sizes, blocks

    def _pref_nums(self, p: pd.DataFrame) -> tuple[FloatArray, FloatArray]:
        cols = []
        masks = []
        for f, center, scale in [
            ("min_age", 25, 10), ("max_age", 40, 10),
            ("min_height_cm", 160, 10), ("max_height_cm", 190, 10),
        ]:
            v = p[f].to_numpy(float)
            m = ~np.isnan(v)
            v = np.clip(np.where(m, v, center), center - 6 * scale, center + 6 * scale)
            cols.append(np.where(m, (v - center) / scale, 0))
            masks.append(m)
        d = p["distance"].to_numpy(float)
        dm = ~np.isnan(d)
        cols.append(np.where(dm, (np.log1p(np.where(dm, d, 1)) - 6) / 2, 0))
        masks.append(dm)
        lo = p["last_online_id"].fillna(4).to_numpy(int)
        lo_oh = np.eye(6)[lo]
        num = np.concatenate([np.stack(cols, 1), lo_oh], axis=1)
        mask = np.concatenate([np.stack(masks, 1), np.ones_like(lo_oh)], axis=1)
        return num.astype(np.float32), mask.astype(np.float32)

    def _pref_two_way(self, p: pd.DataFrame) -> FloatArray:
        v = p[PREF_TWO_WAY + ["has_club_filter"]].fillna(False).to_numpy(bool)
        return v.astype(np.float32)

    def _personality(self) -> FloatArray:
        s = self.people["personality"].to_numpy()
        out = np.zeros((self.n, 47), dtype=np.float32)
        for i, values in enumerate(s):
            if values is not None:
                out[i] = values
        return out

    def who_input_dim(self) -> int:
        return (self.nq + sum(self.cat_sizes) + 2 * 2 + self.loc.shape[1]
                + N_COUNTRIES + self.beh.shape[1] + self.prof.shape[1])

    def look_extra_dim(self) -> int:
        return (self.nq + sum(self.pref_multi_sizes) + 2 * self.pref_num.shape[1]
                + self.pref_two_way.shape[1])


class TensorFeatures:
    """Features as torch tensors on `device`, with batch-encoding helpers."""

    def __init__(self, f: Features, device: torch.device) -> None:
        def t(x: object, dt: torch.dtype) -> torch.Tensor:
            return torch.as_tensor(x, dtype=dt, device=device)

        self.f = f
        self.device = device
        self.answers = t(f.answers, torch.int8)
        self.beh = t(f.beh, torch.float32)
        self.prof = t(f.prof, torch.float32)
        self.cat = t(f.cat, torch.long)
        self.num = t(f.num, torch.float32)
        self.num_mask = t(f.num_mask, torch.float32)
        self.loc = t(f.loc, torch.float32)
        self.country = t(f.country, torch.long)
        self.pref_answers = t(f.pref_answers, torch.int8)
        self.pref_multi = torch.cat(
            [t(b, torch.int8) for b in f.pref_multi], dim=1)
        self.pref_num = t(f.pref_num, torch.float32)
        self.pref_num_mask = t(f.pref_num_mask, torch.float32)
        self.pref_two_way = t(f.pref_two_way, torch.float32)
        self.cat_sizes = f.cat_sizes
        self.pref_multi_sizes = f.pref_multi_sizes

    def who_batch(self, idx: torch.Tensor) -> Batch:
        return dict(
            answers=self.answers[idx].float(),
            beh=self.beh[idx],
            prof=self.prof[idx],
            cat=self.cat[idx],
            num=self.num[idx],
            num_mask=self.num_mask[idx],
            loc=self.loc[idx],
            country=self.country[idx],
        )

    def look_batch(self, idx: torch.Tensor) -> Batch:
        b = self.who_batch(idx)
        b.update(
            pref_answers=self.pref_answers[idx].float(),
            pref_multi=self.pref_multi[idx].float(),
            pref_num=self.pref_num[idx],
            pref_num_mask=self.pref_num_mask[idx],
            pref_two_way=self.pref_two_way[idx],
        )
        return b
