import os

import numpy as np
import numpy.typing as npt
import pandas as pd
import torch

from kvmatching.paths import DATA
from serviceshared.kvmatching.blocks import Blocks, FloatArray, IntArray
from serviceshared.kvmatching.features import (
    behaviour_features,
    fourier_latlon,
    numeric,
    pref_numeric,
    profile_quality_features,
)
from serviceshared.kvmatching.rows import DEFAULT_LAST_ONLINE_ID, UNANSWERED

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


class Features:
    """Dense per-person feature blocks, indexed by row (0..N-1). `pid2row`
    maps person ids to rows. Every block a person's vector is built from
    comes from the serving side's own transforms, so there is one definition
    of each rather than one per side."""

    def __init__(self) -> None:
        people = pd.read_parquet(os.path.join(DATA, "people.parquet")).merge(
            pd.read_parquet(os.path.join(DATA, "eval.parquet")), on="id")
        people = people.sort_values("id").reset_index(drop=True)
        self.people = people
        self.ids = people["id"].to_numpy()
        self.n = len(people)
        self.pid2row = pd.Series(np.arange(self.n), index=self.ids)

        questions = pd.read_parquet(os.path.join(DATA, "questions.parquet"))
        self.qids = questions["id"].to_numpy()
        self.nq = len(self.qids)
        qid2col = pd.Series(np.arange(self.nq), index=self.qids)

        self.birth_year = people["birth_year"].to_numpy(float)
        self.height_cm = people["height_cm"].to_numpy(float)
        self.lat = people["lat"].to_numpy(float)
        self.lon = people["lon"].to_numpy(float)
        self.verification_level_id = (
            people["verification_level_id"].fillna(1).to_numpy(np.int64))
        self.photo_count = people["photo_count"].to_numpy(np.int64)
        self.club_count = people["club_count"].to_numpy(np.int64)

        self.answers = self._load_pm1("answers.parquet", qid2col)
        self.cat_sizes, self.cat = self._cats()
        self.num, self.num_mask = numeric(self.birth_year, self.height_cm)
        self.loc = fourier_latlon(
            self.lat, self.lon, np.array(LOC_FREQS, np.int64))
        self.country = self._country()

        self.pref_answers = self._load_pm1("pref_answers.parquet", qid2col)
        self.pref_multi_sizes, self.pref_multi = self._pref_multi(people)
        self.pref_min_age = people["min_age"].to_numpy(float)
        self.pref_max_age = people["max_age"].to_numpy(float)
        self.pref_min_height_cm = people["min_height_cm"].to_numpy(float)
        self.pref_max_height_cm = people["max_height_cm"].to_numpy(float)
        self.pref_distance = people["distance"].to_numpy(float)
        self.pref_last_online_id = (
            people["last_online_id"].fillna(DEFAULT_LAST_ONLINE_ID)
            .to_numpy(np.int64))
        self.pref_num, self.pref_num_mask = pref_numeric(
            self.pref_min_age, self.pref_max_age, self.pref_min_height_cm,
            self.pref_max_height_cm, self.pref_distance,
            self.pref_last_online_id)
        self.pref_two_way = self._pref_two_way(people)

        self.personality = self._personality()
        self.about = self._about()
        (self.intros_received, self.intros_replied, self.intros_sent,
         self.messages_received) = self._counters()
        self.beh = behaviour_features(
            self.intros_received, self.intros_replied, self.intros_sent,
            self.messages_received)
        self.prof = profile_quality_features(
            self.verification_level_id, self.about, self.photo_count,
            self.club_count)

    def blocks(self, rows: IntArray) -> Blocks:
        """The given rows in the shape the serving side reads its own
        database rows into, so training's inputs can be built by serving's
        own code (see export.py)."""
        return Blocks(
            person_ids=self.ids[rows],
            birth_year=self.birth_year[rows],
            height_cm=self.height_cm[rows],
            lat=self.lat[rows],
            lon=self.lon[rows],
            answers=self.answers[rows].astype(np.float32),
            cats=[self.cat[rows, i] for i in range(len(CAT_FIELDS))],
            country=self.country[rows],
            intros_received=self.intros_received[rows],
            intros_replied=self.intros_replied[rows],
            intros_sent=self.intros_sent[rows],
            messages_received=self.messages_received[rows],
            verification_level_id=self.verification_level_id[rows],
            about=[self.about[i] for i in rows],
            photo_count=self.photo_count[rows],
            club_count=self.club_count[rows],
            pref_answers=self.pref_answers[rows].astype(np.float32),
            pref_multi=np.concatenate(
                [b[rows].astype(np.float32) for b in self.pref_multi], axis=1),
            pref_min_age=self.pref_min_age[rows],
            pref_max_age=self.pref_max_age[rows],
            pref_min_height_cm=self.pref_min_height_cm[rows],
            pref_max_height_cm=self.pref_max_height_cm[rows],
            pref_distance=self.pref_distance[rows],
            pref_last_online_id=self.pref_last_online_id[rows],
            pref_two_way=self.pref_two_way[rows],
        )

    def _about(self) -> list[str | None]:
        return [t if isinstance(t, str) and t else None
                for t in self.people["about"].to_numpy()]

    def _counters(self) -> tuple[IntArray, IntArray, IntArray, IntArray]:
        """The four pre-SPLIT behaviour counters, extracted with the serving
        side's own query."""
        c = pd.read_parquet(os.path.join(DATA, "beh_counts.parquet"))
        c = c.set_index("person_id").reindex(self.ids).fillna(0)
        return (c["count_intros_received"].to_numpy(np.int64),
                c["count_intros_replied"].to_numpy(np.int64),
                c["count_intros_sent"].to_numpy(np.int64),
                c["count_messages_received"].to_numpy(np.int64))

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
            v = self.people[f].fillna(UNANSWERED).to_numpy(int)
            sizes.append(int(v.max()) + 1)
            cols.append(v)
        return sizes, np.stack(cols, axis=1).astype(np.int64)

    def _country(self) -> IntArray:
        c = self.people["country"].fillna("")
        top = c.value_counts().index[:N_COUNTRIES - 1]
        idx = pd.Series(np.arange(1, N_COUNTRIES), index=top)
        return idx.reindex(c).fillna(0).to_numpy().astype(np.int64)

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
