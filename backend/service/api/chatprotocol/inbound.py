"""
Inbound stanzas as frozen dataclasses, plus the parser that turns raw client
JSON text into them.

`parse_incoming(text)` normalizes the input into an `Element` and then
`_interpret` classifies it into exactly one semantic dataclass (or `None`).
Business logic dispatches on the dataclass type and never touches JSON again.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass

import regex

from service.api.chatprotocol.jid import jid_to_username, to_bare_jid
from service.api.chatprotocol.mam_id import decode_mam_id
from service.api.chatprotocol.message import (
    AUDIO_MESSAGE_BODY,
    AudioMessage,
    ChatMessage,
    Message,
    ReactionMessage,
    TypingMessage,
)
from service.api.chatprotocol.element import (
    NS_BIND,
    NS_CLIENT,
    NS_FRAMING,
    NS_SASL,
    NS_SESSION,
    Element,
    element_from_json,
)


@dataclass(frozen=True)
class StreamOpenReq:
    version: str
    to: str


@dataclass(frozen=True)
class SaslAuth:
    payload_b64: str | None


@dataclass(frozen=True)
class IqBind:
    iq_id: str


@dataclass(frozen=True)
class IqSession:
    iq_id: str


@dataclass(frozen=True)
class Ping:
    pass


@dataclass(frozen=True)
class SubscribeOnline:
    uuid: str


@dataclass(frozen=True)
class UnsubscribeOnline:
    uuid: str


@dataclass(frozen=True)
class RegisterPushToken:
    token: str | None


@dataclass(frozen=True)
class RegisterWebPushSubscription:
    subscription: str | None


@dataclass(frozen=True)
class MamQuery:
    query_id: str
    with_username: str
    before: str | None
    max: str | None


@dataclass(frozen=True)
class InboxQuery:
    query_id: str


@dataclass(frozen=True)
class InboxSnapshotQuery:
    """
    The modern inbox query (`duo_query_inbox`). Unlike the legacy `InboxQuery`,
    the response carries complete conversations (person info included), so
    clients don't have to join the inbox against a separate endpoint.
    """
    pass


@dataclass(frozen=True)
class MarkDisplayed:
    to_username: str


@dataclass(frozen=True)
class VisitorsQuery:
    pass


@dataclass(frozen=True)
class MarkVisitorsChecked:
    when: str | None


SessionRequest = StreamOpenReq | SaslAuth | IqBind | IqSession

Inbound = (
    SessionRequest
    | Ping
    | SubscribeOnline
    | UnsubscribeOnline
    | RegisterPushToken
    | RegisterWebPushSubscription
    | MamQuery
    | InboxQuery
    | InboxSnapshotQuery
    | MarkDisplayed
    | VisitorsQuery
    | MarkVisitorsChecked
    | Message
    | ReactionMessage
)


_MAX_EMOJI_LEN = 16

_EMOJI_ELEMENT = r'''
    (?:
        [\U0001F1E6-\U0001F1FF]{2}
      | [0-9#*]\uFE0F?\u20E3
      | \p{Extended_Pictographic}\p{Emoji_Modifier}?\uFE0F?\u20E3?
    )
    (?:
        \u200D
        (?:
            [0-9#*]\uFE0F?\u20E3
          | \p{Extended_Pictographic}\p{Emoji_Modifier}?\uFE0F?\u20E3?
        )
    )*
'''
_EMOJI_RE = regex.compile(_EMOJI_ELEMENT, regex.VERBOSE)


def _is_valid_reaction_emoji(emoji: str) -> bool:
    if emoji == '':
        return True

    if len(emoji) > _MAX_EMOJI_LEN:
        return False

    return _EMOJI_RE.fullmatch(emoji) is not None


def reaction_from_element(el: Element) -> ReactionMessage | None:
    stanza_id = el.get('id')
    stanza_id = stanza_id if stanza_id and len(stanza_id) <= 250 else None

    mam_id = el.get('mam_id')
    target_mam_message_id = decode_mam_id(mam_id) if mam_id else None
    emoji = el.get('emoji') or ''

    if not stanza_id:
        return None
    if target_mam_message_id is None:
        return None
    if not _is_valid_reaction_emoji(emoji):
        return None

    return ReactionMessage(
        stanza_id=stanza_id,
        target_mam_message_id=target_mam_message_id,
        emoji=emoji,
    )


def message_from_element(el: Element) -> Message | None:
    if el.tag != 'message' or el.ns != NS_CLIENT:
        return None

    message_type = el.get('type')

    stanza_id = el.get('id')
    stanza_id = stanza_id if stanza_id and len(stanza_id) <= 250 else None

    audio_base64 = el.get('audio_base64')

    body_el = el.find('body')
    body = (
        body_el.text.strip()
        if body_el is not None and body_el.text and body_el.text.strip()
        else None
    )

    to_username = jid_to_username(el.get('to'))

    raw_question_id = el.get('question_id')
    question_id = (
        int(raw_question_id)
        if raw_question_id and raw_question_id.isdigit()
        else None
    )
    question_id = question_id if question_id and question_id <= 0x7fff else None

    if not stanza_id:
        return None
    if not to_username:
        return None

    if message_type == 'typing':
        return TypingMessage(stanza_id=stanza_id, to_username=to_username)

    if message_type == 'chat':
        if audio_base64:
            return AudioMessage(
                stanza_id=stanza_id,
                to_username=to_username,
                body=AUDIO_MESSAGE_BODY,
                audio_base64=audio_base64,
                audio_uuid=secrets.token_hex(32),
            )
        if body:
            return ChatMessage(
                stanza_id=stanza_id,
                to_username=to_username,
                body=body,
                question_id=question_id,
            )

    return None


def _try_session(el: Element) -> SessionRequest | None:
    if el.tag == 'open' and el.ns == NS_FRAMING:
        version = el.get('version')
        to = el.get('to')
        if version is not None and to is not None:
            return StreamOpenReq(version=version, to=to)
        return None

    if el.tag == 'auth' and el.ns == NS_SASL:
        return SaslAuth(payload_b64=el.text)

    if el.tag == 'iq' and el.ns == NS_CLIENT:
        iq_id = el.get('id') or 'default'
        bind = el.find('bind')
        if bind is not None and bind.ns == NS_BIND:
            return IqBind(iq_id=iq_id)
        session = el.find('session')
        if session is not None and session.ns == NS_SESSION:
            return IqSession(iq_id=iq_id)

    return None


def _try_mam(el: Element) -> MamQuery | None:
    query = el if el.tag == 'query' else el.descendant('query')
    if query is None:
        return None

    query_id = query.get('queryid')
    if not query_id:
        return None

    with_username = None
    for field in el.descendants('field'):
        if field.get('var') == 'with':
            value = field.find('value')
            if value is not None and value.text:
                with_username = value.text

    with_bare = to_bare_jid(with_username) if with_username else None
    if not with_bare:
        return None

    before_el = el.descendant('before')
    max_el = el.descendant('max')

    before = (
        before_el.text if before_el is not None and before_el.text else None
    )
    max_ = max_el.text if max_el is not None and max_el.text else None

    return MamQuery(
        query_id=query_id,
        with_username=with_bare,
        before=before,
        max=max_,
    )


def _try_inbox(el: Element) -> InboxQuery | None:
    inbox: Element | None
    if el.tag == 'inbox':
        inbox = el
    elif el.tag == 'iq':
        inbox = el.find('inbox')
    else:
        inbox = None

    if inbox is None:
        return None

    query_id = inbox.get('queryid')
    if not query_id:
        return None

    return InboxQuery(query_id=query_id)


def _try_mark_displayed(el: Element) -> MarkDisplayed | None:
    if el.tag != 'message':
        return None
    if el.find('displayed') is None:
        return None

    to_username, *_ = (el.get('to') or '').split('@')
    if not to_username:
        return None

    return MarkDisplayed(to_username=to_username)


def _interpret(el: Element) -> Inbound | None:
    session_request = _try_session(el)
    if session_request is not None:
        return session_request

    if el.tag == 'duo_ping':
        return Ping()

    if el.tag == 'duo_subscribe_online':
        uuid_ = el.get('uuid')
        return SubscribeOnline(uuid=uuid_) if uuid_ else None

    if el.tag == 'duo_unsubscribe_online':
        uuid_ = el.get('uuid')
        return UnsubscribeOnline(uuid=uuid_) if uuid_ else None

    if el.tag == 'duo_register_push_token':
        return RegisterPushToken(token=el.get('token'))

    if el.tag == 'duo_register_web_push_subscription':
        return RegisterWebPushSubscription(subscription=el.get('subscription'))

    if el.tag == 'duo_query_visitors':
        return VisitorsQuery()

    if el.tag == 'duo_query_inbox':
        return InboxSnapshotQuery()

    if el.tag == 'duo_mark_visitors_checked':
        return MarkVisitorsChecked(when=el.get('when'))

    if el.tag == 'duo_reaction':
        return reaction_from_element(el)

    mam = _try_mam(el)
    if mam is not None:
        return mam

    inbox = _try_inbox(el)
    if inbox is not None:
        return inbox

    mark_displayed = _try_mark_displayed(el)
    if mark_displayed is not None:
        return mark_displayed

    return message_from_element(el)


def parse_incoming(text: str) -> Inbound | None:
    el = element_from_json(text)

    if el is None:
        return None

    return _interpret(el)
