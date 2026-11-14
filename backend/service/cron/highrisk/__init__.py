import asyncio
import logging
import random
from collections.abc import Sequence
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

from serviceshared.antiabuse.highrisk import features, model
from serviceshared.antiabuse.highrisk.sql import (
    Q_ACTIVITY,
    Q_LINKED,
    Q_MESSAGES,
    Q_PHOTOS,
    Q_PROFILES,
    Q_SESSIONS,
)
from serviceshared.antiabuse.lodgereport import lodge_report
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

FIRST_CHECK_HOURS = 0.1

GRACE_HOURS = 1

Action = Literal['photo verification', 'shadow ban']

_SEVERITY: list[Action | None] = [None, 'photo verification', 'shadow ban']


class NewPerson(BaseModel):
    bot_uuid: UUID
    person_id: int
    person_uuid: UUID
    hours_since_sign_up: float
    previous_score: float | None
    previous_hours: list[int]


def action(risk: float | None) -> Action | None:
    if risk is None:
        return None
    if risk >= HIGH_RISK_SHADOW_BAN_THRESHOLD:
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
        if hours_since_sign_up >= max(h, FIRST_CHECK_HOURS)
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


async def score(
    targets: Sequence[tuple[int, int]],
) -> dict[tuple[int, int], float]:
    params = dict(
        person_ids=[person_id for person_id, _ in targets],
        hours=[hours for _, hours in targets],
    )

    async with api_tx('read committed') as tx:
        profiles = await (await tx.execute(Q_PROFILES, params)).fetchall()
        photos = await (await tx.execute(Q_PHOTOS, params)).fetchall()
        sessions = await (await tx.execute(Q_SESSIONS, params)).fetchall()
        messages = await (await tx.execute(Q_MESSAGES, params)).fetchall()
        activity = await (await tx.execute(Q_ACTIVITY, params)).fetchall()
        linked = await (await tx.execute(Q_LINKED, params)).fetchall()

    examples = await asyncio.to_thread(
        features.build,
        profiles=[features.Profile(**r) for r in profiles],
        photos=features.group_photos([features.Photo(**r) for r in photos]),
        sessions=[features.Session(**r) for r in sessions],
        messages=[features.Message(**r) for r in messages],
        activity=[features.Activity(**r) for r in activity],
        linked=[features.Linked(**r) for r in linked],
    )

    scores = await asyncio.to_thread(model.score, examples)

    return {
        (e.person_id, e.hours): float(s) for e, s in zip(examples, scores)
    }


async def check_high_risk_once() -> None:
    async with api_tx('read committed') as tx:
        await tx.execute(
            Q_SELECT_NEW_PEOPLE,
            dict(max_hours=max(features.CHECKPOINT_HOURS) + GRACE_HOURS))
        people = [NewPerson(**row) for row in await tx.fetchall()]

    due = []
    for person in people:
        hours = due_checkpoint(
            person.hours_since_sign_up, person.previous_hours)
        if hours is not None:
            due.append((person, hours))

    if not due:
        return

    risks = await score([(person.person_id, hours) for person, hours in due])

    for person, hours in due:
        risk = risks[person.person_id, hours]
        act = action(risk)
        escalates = _SEVERITY.index(act) > _SEVERITY.index(
            action(person.previous_score))
        is_shadow_banned = False

        async with api_tx() as tx:
            await tx.execute(Q_INSERT_SCORE, dict(
                person_id=person.person_id, hours=hours, score=risk))

            if escalates and not DRY_RUN and act == 'photo verification':
                await tx.execute(Q_REQUIRE_PHOTO_VERIFICATION, dict(
                    person_id=person.person_id))

            if escalates and not DRY_RUN and act == 'shadow ban':
                cur = await tx.execute(Q_SHADOW_BAN, dict(
                    object_uuid=str(person.person_uuid)))
                is_shadow_banned = cur.rowcount > 0

        if act is None or not escalates:
            continue

        logger.info(f'{person.person_uuid} high risk: {act} ({risk:.3f})')
        await lodge_report(
            subject_uuid=str(person.bot_uuid),
            object_uuid=str(person.person_uuid),
            reason=reason(hours, risk, act),
            is_automoded=not DRY_RUN,
            is_shadow_banned=is_shadow_banned,
            underage_source=None,
            messages=None,
        )


async def check_high_risk_forever() -> None:
    await asyncio.sleep(random.randint(0, MAX_RANDOM_START_DELAY))
    while True:
        await log_stacktrace(check_high_risk_once)
        await asyncio.sleep(HIGH_RISK_POLL_SECONDS)
