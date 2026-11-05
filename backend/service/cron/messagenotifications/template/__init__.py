from service.cron.emailtemplate import notification_emailtemplate

MESSAGE_SUBJECT = 'You have a new message 😍'

MESSAGE_URL = 'https://get.duolicious.app/inbox'

def big_part(has_intro: bool, has_chat: bool) -> str:
    if has_intro and has_chat:
        return 'You have new messages in your chats and intros!'
    if has_intro:
        return 'You have a new message in your intros!'
    if has_chat:
        return 'You have a new message in your chats!'
    return (
        "Our notifier is broken 😵‍💫. Please report this "
        "to support@duolicious.app")

def little_part(has_intro: bool, has_chat: bool) -> str:
    if has_intro and has_chat:
        return 'Open the app to read them'
    return 'Open the app to read it'

def emailtemplate(person_uuid: str, has_intro: bool, has_chat: bool) -> str:
    return notification_emailtemplate(
        person_uuid=person_uuid,
        subject=MESSAGE_SUBJECT,
        big=big_part(has_intro, has_chat),
        little=little_part(has_intro, has_chat),
        url=MESSAGE_URL,
    )
