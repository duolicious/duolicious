from service.cron.emailtemplate import notification_emailtemplate
from typing import Literal

MESSAGE_SUBJECT = 'You have a new message 😍'

MESSAGE_URL = 'https://get.duolicious.app/inbox'

def big_part(kind: Literal['intro', 'chat']) -> str:
    return f'You have a new message in your {kind}s!'

def emailtemplate(person_uuid: str, kind: Literal['intro', 'chat']) -> str:
    return notification_emailtemplate(
        person_uuid=person_uuid,
        subject=MESSAGE_SUBJECT,
        big=big_part(kind),
        little='Open the app to read it',
        url=MESSAGE_URL,
    )
