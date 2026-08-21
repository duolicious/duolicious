from serviceshared.database import api_tx

Q_INCREMENT_UNSEEN_NOTIFICATION_COUNT = """
UPDATE
    person
SET
    unseen_notification_count = unseen_notification_count + 1
WHERE
    uuid = uuid_or_null(%(username)s)
RETURNING
    unseen_notification_count
"""

async def increment_unseen_notification_count(username: str) -> int | None:
    """
    Bump `person.unseen_notification_count` and return the new count, or None
    if no such person exists. The count is stamped into pushes as the iOS
    app-icon badge, so callers must increment once per person per
    notification, not once per device, so that every device shows the same
    badge.
    """
    async with api_tx('read committed') as tx:
        cur = await tx.execute(
                Q_INCREMENT_UNSEEN_NOTIFICATION_COUNT,
                dict(username=username))
        row = await cur.fetchone()

    return row['unseen_notification_count'] if row else None
