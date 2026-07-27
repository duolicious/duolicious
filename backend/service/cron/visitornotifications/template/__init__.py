from constants import (
    VISITOR_NOTIFICATION_BODY,
    VISITOR_NOTIFICATION_TITLE,
)
from service.cron.emailtemplate import notification_emailtemplate

VISITOR_SUBJECT = VISITOR_NOTIFICATION_TITLE

VISITOR_BIG_PART = VISITOR_NOTIFICATION_BODY

VISITOR_LITTLE_PART = 'Open the app to see who'

VISITOR_URL = 'https://get.duolicious.app/visitors'

def visitor_emailtemplate(email: str) -> str:
    return notification_emailtemplate(
        email=email,
        subject=VISITOR_SUBJECT,
        big=VISITOR_BIG_PART,
        little=VISITOR_LITTLE_PART,
        url=VISITOR_URL,
    )
