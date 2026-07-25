import re
from dataclasses import dataclass
from constants import (
    MAX_NOTIFICATION_LENGTH,
)
from gifproviders import GIF_PROVIDERS

# Non-breaking spaces are inserted so that only the first line shows on old
# clients, in inboxes, and in notifications
NON_BREAKING_SPACES = '\xa0' * MAX_NOTIFICATION_LENGTH

AUDIO_MESSAGE_BODY = f"""
Voice message
{NON_BREAKING_SPACES}
Upgrade to the latest version of Duolicious to hear this message
""".strip()

GIF_MESSAGE_BODY = '🖼️ GIF'

_GIF_URL_REGEX = re.compile(
    r'^https://('
    + '|'.join(re.escape(host) for host in GIF_PROVIDERS.values())
    + r')/\S+\.(gif|webp)$',
    re.IGNORECASE,
)

def is_gif_url(body: str) -> bool:
    return bool(_GIF_URL_REGEX.match(body))

def gif_aware_body(body: str) -> str:
    return GIF_MESSAGE_BODY if is_gif_url(body) else body

@dataclass(frozen=True)
class BaseMessage:
    stanza_id: str
    to_username: str


@dataclass(frozen=True)
class ChatMessage(BaseMessage):
    body: str
    question_id: int | None = None


@dataclass(frozen=True)
class TypingMessage(BaseMessage):
    pass


@dataclass(frozen=True)
class AudioMessage(BaseMessage):
    body: str
    audio_base64: str
    audio_uuid: str


@dataclass(frozen=True)
class ReactionMessage:
    stanza_id: str
    target_mam_message_id: int
    emoji: str


Message = ChatMessage | TypingMessage | AudioMessage
