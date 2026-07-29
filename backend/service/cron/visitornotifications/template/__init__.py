from constants import (
    VISITOR_NOTIFICATION_BODY,
    VISITOR_NOTIFICATION_BODY_PLURAL,
    VISITOR_NOTIFICATION_TITLE,
    VISITOR_NOTIFICATION_TITLE_PLURAL,
)
from service.cron.emailtemplate import notification_emailtemplate

VISITOR_LITTLE_PART = 'Open the app to see who'

VISITOR_URL = 'https://get.duolicious.app/visitors'

def count_part(visitor_count: int) -> str:
    if visitor_count > 99:
        return '99+'
    return str(visitor_count)

def title_part(visitor_count: int) -> str:
    if visitor_count > 1:
        return VISITOR_NOTIFICATION_TITLE_PLURAL.format(
            count=count_part(visitor_count))
    return VISITOR_NOTIFICATION_TITLE

def big_part(visitor_count: int) -> str:
    if visitor_count > 1:
        return VISITOR_NOTIFICATION_BODY_PLURAL.format(
            count=count_part(visitor_count))
    return VISITOR_NOTIFICATION_BODY

def visitor_emailtemplate(email: str, visitor_count: int) -> str:
    return notification_emailtemplate(
        email=email,
        subject=title_part(visitor_count),
        big=big_part(visitor_count),
        little=VISITOR_LITTLE_PART,
        url=VISITOR_URL,
    )
