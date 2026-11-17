import itertools
import math
import zlib
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from pydantic import BaseModel

from serviceshared.antiabuse.highrisk import encoder, ipinfo

CHECKPOINT_HOURS = (0, 1, 3, 6)

FIRST_CHECK_HOURS = 0.1

SESSION_AGE_ERROR_HOURS = 72.0

SIGN_UP_SESSION_HOURS = (-24.0 - SESSION_AGE_ERROR_HOURS, 0.05)


class Profile(BaseModel):
    person_id: int
    hours: int
    age: int
    about: str
    sign_up_hour: float
    latitude: float
    longitude: float
    country: str
    genders_sought: int | None
    seeks_men: bool
    seeks_women: bool


class Session(BaseModel):
    person_id: int
    hours: int
    ip: str
    hours_after_sign_up: float


class Message(BaseModel):
    person_id: int
    hours: int
    sent: bool
    remote_bare_jid: str
    body: str
    is_audio: bool
    first_in_chat: bool
    hours_after_sign_up: float


class Photo(BaseModel):
    person_id: int
    clip_embedding: list[float]


class Activity(BaseModel):
    person_id: int
    hours: int
    skips_made: int
    reports_made: int
    skips_got: int
    reports_got: int
    visits_made: int
    visits_got: int
    recipient_men: float | None
    recipient_age_gap: float | None
    recipient_km: float | None
    visit_age_gap: float | None
    visit_men: float | None


class NetworkActivity(BaseModel):
    person_id: int
    hours: int
    sign_ups: float
    shadow_bans: float


@dataclass(frozen=True)
class Example:
    person_id: int
    hours: int
    numbers: dict[str, float]
    texts: dict[str, str]
    vectors: dict[str, npt.NDArray[np.float32]]
    photos: npt.NDArray[np.float32] | None


def group_photos(
    rows: Sequence[Photo],
) -> dict[int, list[npt.NDArray[np.float32]]]:
    photos: dict[int, list[npt.NDArray[np.float32]]] = {}
    for row in rows:
        photos.setdefault(row.person_id, []).append(
            np.array(row.clip_embedding, np.float32))
    return photos


def ngrams(text: str, buckets: int) -> npt.NDArray[np.int64]:
    text = f' {text.lower()} '
    return np.array(sorted({
        zlib.crc32(text[i:i + n].encode()) % buckets
        for n in range(2, 6)
        for i in range(len(text) - n + 1)
    }), np.int64)


def _cosine(a: npt.NDArray[np.float32], b: npt.NDArray[np.float32]) -> float:
    norm = float(np.linalg.norm(a) * np.linalg.norm(b))
    return float(a @ b) / norm if norm else math.nan


def _similarity(texts: Sequence[str]) -> float:
    vectors = [encoder.embed([text]) for text in texts]
    return float(np.mean([
        _cosine(a, b) for a, b in itertools.combinations(vectors, 2)
    ])) if len(vectors) > 1 else math.nan


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2)
         * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 12742 * math.asin(math.sqrt(min(a, 1)))


def at_sign_up(sessions: Sequence[Session]) -> list[Session]:
    lo, hi = SIGN_UP_SESSION_HOURS
    return sorted(
        (s for s in sessions if lo <= s.hours_after_sign_up <= hi),
        key=lambda s: s.hours_after_sign_up)


def _sign_up_ip(
    p: Profile,
    sessions: Sequence[Session],
) -> tuple[dict[str, float], dict[str, str]]:
    sign_up = at_sign_up(sessions)

    if not sign_up:
        return dict(
            ip_v6=math.nan,
            ip_km=math.nan,
        ), dict(owner='', ip_country='')

    ip = sign_up[-1].ip
    info = ipinfo.lookup(ip)
    return dict(
        ip_v6=float(':' in ip),
        ip_km=(
            math.nan if info.latitude is None or info.longitude is None
            else _km(p.latitude, p.longitude, info.latitude, info.longitude)),
    ), dict(owner=info.organization, ip_country=info.country)


def _messages(
    messages: Sequence[Message],
) -> tuple[dict[str, float], list[str]]:
    sent = [m for m in messages if m.sent]
    intros = [m for m in sent if m.first_in_chat]

    return dict(
        sent=float(len(sent)),
        intros=float(len(intros)),
        got_intros=float(sum(
            1 for m in messages if not m.sent and m.first_in_chat)),
        recipients=float(len({m.remote_bare_jid for m in sent})),
        replies=float(len(sent) - len(intros)),
        intro_share=len(intros) / len(sent) if sent else math.nan,
        first_intro_hours=min(
            (m.hours_after_sign_up for m in intros), default=math.nan),
        intro_similarity=_similarity([
            m.body for m in intros if not m.is_audio and m.body.strip()]),
    ), [m.body for m in sent if not m.is_audio]


def _activity(activity: Activity) -> dict[str, float]:
    return {
        name: math.nan if value is None else float(value) for name, value
        in activity.model_dump(exclude={'person_id', 'hours'}).items()}


def _network_activity(activity: NetworkActivity) -> dict[str, float]:
    neighbours = max(activity.sign_ups - 1, 0)
    return dict(
        network_neighbours=neighbours / (neighbours + 1),
        network_shadow_bans=activity.shadow_bans / (activity.shadow_bans + 1),
        network_shadow_ban_share=(
            activity.shadow_bans / max(activity.sign_ups, 1)),
    )


def build(
    profiles: Sequence[Profile],
    photos: dict[int, list[npt.NDArray[np.float32]]],
    sessions: Sequence[Session],
    messages: Sequence[Message],
    activity: Sequence[Activity],
    network_activity: Sequence[NetworkActivity],
) -> list[Example]:
    sessions_by_target: defaultdict[tuple[int, int], list[Session]] = (
        defaultdict(list))
    for s in sessions:
        sessions_by_target[s.person_id, s.hours].append(s)

    messages_by_target: defaultdict[tuple[int, int], list[Message]] = (
        defaultdict(list))
    for m in messages:
        messages_by_target[m.person_id, m.hours].append(m)

    activity_by_target = {(a.person_id, a.hours): a for a in activity}
    network_activity_by_target = {
        (n.person_id, n.hours): n for n in network_activity}

    examples = []
    for p in profiles:
        ip_numbers, ip_texts = _sign_up_ip(
            p, sessions_by_target[p.person_id, p.hours])
        message_numbers, sent = _messages(
            messages_by_target[p.person_id, p.hours])
        embeddings = photos.get(p.person_id, [])
        sign_up_angle = 2 * math.pi * p.sign_up_hour / 24
        bio = encoder.embed([p.about])
        sent_vector = encoder.embed(sent)
        examples.append(Example(
            person_id=p.person_id,
            hours=p.hours,
            numbers=dict(
                age=float(p.age),
                sign_up_hour_sin=math.sin(sign_up_angle),
                sign_up_hour_cos=math.cos(sign_up_angle),
                genders_sought=(
                    math.nan if p.genders_sought is None
                    else float(p.genders_sought)),
                seeks_men=float(p.seeks_men),
                seeks_women=float(p.seeks_women),
                bio_message_similarity=_cosine(bio, sent_vector),
                **ip_numbers,
                **message_numbers,
                **_network_activity(
                    network_activity_by_target[p.person_id, p.hours]),
                **_activity(activity_by_target[p.person_id, p.hours]),
            ),
            texts=dict(profile_country=p.country, **ip_texts),
            vectors=dict(bio=bio, sent=sent_vector),
            photos=(
                np.stack([np.mean(embeddings, axis=0), embeddings[0]])
                if embeddings else None),
        ))
    return examples
