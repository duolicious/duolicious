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

SIGN_UP_SESSION_HOURS = (-24.0, 0.05)


class Profile(BaseModel):
    person_id: int
    hours: int
    gender_id: int
    age: int
    name: str
    about: str
    email_domain: str
    sign_up_hour: float
    latitude: float
    longitude: float
    country: str


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
    rude_messages: int


class Linked(BaseModel):
    person_id: int
    hours: int
    people: int
    banned: int
    recent: int
    alike: int


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


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2)
         * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 12742 * math.asin(math.sqrt(min(a, 1)))


def _sign_up_ip(
    p: Profile,
    sessions: Sequence[Session],
) -> tuple[dict[str, float], list[str]]:
    lo, hi = SIGN_UP_SESSION_HOURS
    sign_up = sorted(
        (s for s in sessions if lo <= s.hours_after_sign_up <= hi),
        key=lambda s: s.hours_after_sign_up)

    if not sign_up:
        return dict(
            ip_v6=math.nan,
            ip_km=math.nan,
            ip_matches_country=math.nan,
        ), []

    ip = sign_up[-1].ip
    info = ipinfo.lookup(ip)
    return dict(
        ip_v6=float(':' in ip),
        ip_km=(
            math.nan if info.latitude is None or info.longitude is None
            else _km(p.latitude, p.longitude, info.latitude, info.longitude)),
        ip_matches_country=float(info.country == p.country),
    ), [f'{info.country} AS{info.asn} {info.organization}']


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
    ), [m.body for m in sent if not m.is_audio]


def _activity(activity: Activity) -> dict[str, float]:
    return {
        name: float(count) for name, count
        in activity.model_dump(exclude={'person_id', 'hours'}).items()}


def _linked(linked: Linked) -> dict[str, float]:
    return dict(
        linked_people=math.log1p(linked.people),
        linked_banned=math.log1p(linked.banned),
        linked_recent=math.log1p(linked.recent),
        linked_alike=math.log1p(linked.alike),
        linked_banned_share=(
            linked.banned / linked.people if linked.people else 0.0),
    )


def build(
    profiles: Sequence[Profile],
    photos: dict[int, list[npt.NDArray[np.float32]]],
    sessions: Sequence[Session],
    messages: Sequence[Message],
    activity: Sequence[Activity],
    linked: Sequence[Linked],
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
    linked_by_target = {(n.person_id, n.hours): n for n in linked}

    examples = []
    for p in profiles:
        ip_numbers, networks = _sign_up_ip(
            p, sessions_by_target[p.person_id, p.hours])
        message_numbers, sent = _messages(
            messages_by_target[p.person_id, p.hours])
        embeddings = photos.get(p.person_id, [])
        sign_up_angle = 2 * math.pi * p.sign_up_hour / 24
        examples.append(Example(
            person_id=p.person_id,
            hours=p.hours,
            numbers=dict(
                log_hours=math.log1p(p.hours),
                woman=float(p.gender_id == 2),
                age=float(p.age),
                sign_up_hour_sin=math.sin(sign_up_angle),
                sign_up_hour_cos=math.cos(sign_up_angle),
                **ip_numbers,
                **message_numbers,
                **_linked(linked_by_target[p.person_id, p.hours]),
                **_activity(activity_by_target[p.person_id, p.hours]),
            ),
            texts=dict(
                bio=f'{p.about} | {p.name}',
                messages='\n'.join(sent),
                origin=' | '.join([p.email_domain, p.country, *networks]),
            ),
            vectors=dict(
                bio=encoder.embed([p.about]),
                sent=encoder.embed(sent),
            ),
            photos=(
                np.stack([np.mean(embeddings, axis=0), embeddings[0]])
                if embeddings else None),
        ))
    return examples
