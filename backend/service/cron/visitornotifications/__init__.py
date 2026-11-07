from serviceshared.commonsql import (
    Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME,
)
from service.cron.notificationdispatch import NotificationKind
from service.cron.visitornotifications.template import (
    big_part,
    title_part,
    visitor_emailtemplate,
)

VISITOR_NOTIFICATIONS = NotificationKind(
    name='visitor',
    unseen_count="""
        -- How many people visited since the person was last online, so the
        -- copy can say how many. Capped at 100 (rendered as "99+"), so the
        -- scan stops early for very popular profiles.
        SELECT
            COUNT(*)
        FROM (
            SELECT
                1
            FROM
                visited
            JOIN
                person AS visitor
            ON
                visitor.id = visited.subject_person_id
            WHERE
                visited.object_person_id = person.id
            AND
                NOT visited.invisible
            AND
                visited.updated_at > person.last_online_time
            AND
                visitor.activated
            AND
                visitor.shadow_banned_at IS NULL
            LIMIT 100
        ) AS visitor
    """,
    stamp=Q_UPSERT_LAST_VISITOR_NOTIFICATION_TIME,
    subject=lambda row: title_part(row.unseen_count),
    screen={'screen': 'Home', 'params': {'screen': 'Visitors'}},
    push_body=lambda row: big_part(row.unseen_count),
    email_body=lambda row: visitor_emailtemplate(
        person_uuid=row.person_uuid, visitor_count=row.unseen_count),
)
