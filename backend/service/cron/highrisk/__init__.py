import asyncio
import logging
import random
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from serviceshared.antiabuse.highrisk import features, model
from serviceshared.antiabuse.highrisk.sql import (
    Q_ACTIVITY,
    Q_MESSAGES,
    Q_NETWORK_ACTIVITY,
    Q_PHOTOS,
    Q_PROFILES,
    Q_SESSIONS,
)
from serviceshared.antiabuse.lodgereport import lodge_report
from serviceshared.antiabuse.networkactivity.count import (
    count_network_activity,
)
from serviceshared.antiabuse.sql import Q_SHADOW_BAN
from serviceshared.database import api_tx
from service.cron.cronutil import MAX_RANDOM_START_DELAY, log_stacktrace
from service.cron.highrisk.sql import (
    Q_INSERT_SCORE,
    Q_REQUIRE_PHOTO_VERIFICATION,
    Q_SELECT_NEW_PEOPLE,
)
from serviceshared.duoenv.cron import (
    HIGH_RISK_DRY_RUN as DRY_RUN,
    HIGH_RISK_POLL_SECONDS,
    HIGH_RISK_SHADOW_BAN_THRESHOLD,
    HIGH_RISK_VERIFY_THRESHOLD,
)

logger = logging.getLogger(__name__)

GRACE_HOURS = 1

Action = Literal['photo verification', 'shadow ban']

_SEVERITY: list[Action | None] = [None, 'photo verification', 'shadow ban']


class NewPerson(BaseModel):
    bot_uuid: UUID
    person_id: int
    person_uuid: UUID
    has_gold: bool
    hours_since_sign_up: float
    previous_score: float | None
    previous_hours: list[int]


def action(risk: float | None, has_gold: bool) -> Action | None:
    if risk is None:
        return None
    if risk >= HIGH_RISK_SHADOW_BAN_THRESHOLD and not has_gold:
        return 'shadow ban'
    if risk >= HIGH_RISK_VERIFY_THRESHOLD:
        return 'photo verification'
    return None


def due_checkpoint(
    hours_since_sign_up: float,
    previous_hours: list[int],
) -> int | None:
    due = [
        h for h in features.CHECKPOINT_HOURS
        if hours_since_sign_up >= max(h, features.FIRST_CHECK_HOURS)
        and h > max(previous_hours, default=-1)
    ]
    return max(due, default=None)


def reason(hours: int, risk: float, act: Action) -> str:
    when = 'at sign-up' if hours == 0 else f'{hours} h after sign-up'
    outcome = (
        'shadow banned them' if act == 'shadow ban'
        else 'required photo verification')
    prefix = 'Dry run: would have ' if DRY_RUN else 'Automatically '
    return f'{prefix}{outcome}. High-risk score {when}: {risk:.3f}.'


def escalates(
    risk: float,
    previous_score: float | None,
    has_gold: bool,
) -> bool:
    return _SEVERITY.index(action(risk, has_gold)) > _SEVERITY.index(
        action(previous_score, has_gold))


async def score(person_id: int, hours: int) -> float | None:
    params = dict(person_ids=[person_id], hours=[hours])

    async with api_tx('read committed') as tx:
        profiles = await (await tx.execute(Q_PROFILES, params)).fetchall()
        photos = await (await tx.execute(Q_PHOTOS, params)).fetchall()
        sessions = await (await tx.execute(Q_SESSIONS, params)).fetchall()
        messages = await (await tx.execute(Q_MESSAGES, params)).fetchall()
        activity = await (await tx.execute(Q_ACTIVITY, params)).fetchall()
        network_activity = await (
            await tx.execute(Q_NETWORK_ACTIVITY, params)).fetchall()

    examples = await asyncio.to_thread(
        features.build,
        profiles=[features.Profile(**r) for r in profiles],
        photos=features.group_photos([features.Photo(**r) for r in photos]),
        sessions=[features.Session(**r) for r in sessions],
        messages=[features.Message(**r) for r in messages],
        activity=[features.Activity(**r) for r in activity],
        network_activity=[
            features.NetworkActivity(**r) for r in network_activity],
    )

    scores = await asyncio.to_thread(model.score, examples)

    return float(scores[0]) if len(scores) else None


async def check(person: NewPerson) -> None:
    hours = due_checkpoint(person.hours_since_sign_up, person.previous_hours)

    if hours is None:
        return

    risk = await score(person.person_id, hours)

    if risk is None:
        return

    act = action(risk, person.has_gold)
    is_stricter = escalates(risk, person.previous_score, person.has_gold)
    acts = is_stricter and not DRY_RUN
    is_acted = False

    async with api_tx('read committed') as tx:
        if acts and act == 'photo verification':
            cur = await tx.execute(Q_REQUIRE_PHOTO_VERIFICATION, dict(
                person_id=person.person_id))
            is_acted = cur.rowcount > 0

        if acts and act == 'shadow ban':
            cur = await tx.execute(Q_SHADOW_BAN, dict(
                object_uuid=str(person.person_uuid),
                shadow_banned_by='model'))
            is_acted = cur.rowcount > 0

        await tx.execute(Q_INSERT_SCORE, dict(
            person_id=person.person_id,
            hours=hours,
            score=risk))

    if is_acted and act == 'shadow ban':
        await count_network_activity('shadow_bans', [person.person_id])

    if act is None or not is_stricter or (acts and not is_acted):
        return

    logger.info(f'{person.person_uuid} high risk: {act} ({risk:.3f})')
    await lodge_report(
        subject_uuid=str(person.bot_uuid),
        object_uuid=str(person.person_uuid),
        reason=reason(hours, risk, act),
        is_automoded=not DRY_RUN,
        is_shadow_banned=is_acted and act == 'shadow ban',
        underage_source=None,
        messages=None,
    )


async def check_high_risk_once() -> None:
    async with api_tx('read committed') as tx:
        await tx.execute(
            Q_SELECT_NEW_PEOPLE,
            dict(max_hours=max(features.CHECKPOINT_HOURS) + GRACE_HOURS))
        people = [NewPerson(**row) for row in await tx.fetchall()]

    for person in people:
        await log_stacktrace(lambda: check(person))


async def check_high_risk_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(check_high_risk_once)
        await asyncio.sleep(HIGH_RISK_POLL_SECONDS)
