from dataclasses import dataclass
from constants import (
    MAX_NOTIFICATION_LENGTH,
)

# Non-breaking spaces are inserted so that only the first line shows on old
# clients, in inboxes, and in notifications
NON_BREAKING_SPACES = '\xa0' * MAX_NOTIFICATION_LENGTH

AUDIO_MESSAGE_BODY = f"""
Voice message
{NON_BREAKING_SPACES}
Upgrade to the latest version of Duolicious to hear this message
""".strip()

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
