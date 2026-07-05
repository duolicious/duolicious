"""
Outbound stanzas as frozen dataclasses.

Each stanza renders itself to the client wire format via `to_json()`, derived
from a single ordered `canonical()` dict (in the xmltodict shape: `@attr` for
attributes, `#text`/scalar for text, nested dicts for children).

The Redis bus carries a protocol-neutral `{"kind": <ClassName>, ...fields}`
payload via `to_bus`/`from_bus`; the websocket boundary then renders it to JSON.
"""
from __future__ import annotations

import dataclasses
import json
from dataclasses import dataclass
from typing import TypedDict

from chatprotocol.jid import LSERVER
from chatprotocol.element import (
    NS_BIND,
    NS_CLIENT,
    NS_FRAMING,
    NS_SASL,
    NS_SESSION,
)

NS_RECEIPTS = 'urn:xmpp:receipts'
NS_DELAY = 'urn:xmpp:delay'
NS_FORWARD = 'urn:xmpp:forward:0'
NS_MAM = 'urn:xmpp:mam:2'
NS_INBOX = 'erlang-solutions.com:xmpp:inbox:0'
NS_CHAT_MARKERS = 'urn:xmpp:chat-markers:0'
NS_STREAMS = 'http://etherx.jabber.org/streams'
NS_TLS = 'urn:ietf:params:xml:ns:xmpp-tls'

_REGISTRY: dict[str, type['Outbound']] = {}


def _register(cls: type['Outbound']) -> type['Outbound']:
    _REGISTRY[cls.__name__] = cls
    return cls


@dataclass(frozen=True)
class Outbound:
    def canonical(self) -> dict:
        raise NotImplementedError

    def to_json(self) -> str:
        return json.dumps(self.canonical())


def to_bus(obj: Outbound) -> str:
    payload = dataclasses.asdict(obj)
    payload['kind'] = type(obj).__name__
    return json.dumps(payload)


def from_bus(serialized: str) -> Outbound:
    payload = json.loads(serialized)
    cls = _REGISTRY[payload.pop('kind')]
    field_names = {field.name for field in dataclasses.fields(cls)}
    kwargs = {k: v for k, v in payload.items() if k in field_names}
    return cls(**kwargs)


def _jid(username: str) -> str:
    return f'{username}@{LSERVER}'


# --------------------------------------------------------------------------- #
# Control stanzas                                                             #
# --------------------------------------------------------------------------- #

@_register
@dataclass(frozen=True)
class Pong(Outbound):
    def canonical(self) -> dict:
        return {'duo_pong': {
            '@preferred_interval': '10000',
            '@preferred_timeout': '5000',
        }}


@_register
@dataclass(frozen=True)
class RegistrationSuccessful(Outbound):
    def canonical(self) -> dict:
        return {'duo_registration_successful': None}


@_register
@dataclass(frozen=True)
class SubscribeOk(Outbound):
    username: str

    def canonical(self) -> dict:
        return {'duo_subscribe_successful': {'@uuid': self.username}}


@_register
@dataclass(frozen=True)
class SubscribeBad(Outbound):
    username: str

    def canonical(self) -> dict:
        return {'duo_subscribe_unsuccessful': {'@uuid': self.username}}


@_register
@dataclass(frozen=True)
class UnsubscribeOk(Outbound):
    username: str

    def canonical(self) -> dict:
        return {'duo_unsubscribe_successful': {'@uuid': self.username}}


@_register
@dataclass(frozen=True)
class UnsubscribeBad(Outbound):
    username: str

    def canonical(self) -> dict:
        return {'duo_unsubscribe_unsuccessful': {'@uuid': self.username}}


@_register
@dataclass(frozen=True)
class OnlineEvent(Outbound):
    username: str
    status: str

    def canonical(self) -> dict:
        return {'duo_online_event': {
            '@uuid': self.username,
            '@status': self.status,
        }}


@_register
@dataclass(frozen=True)
class VisitorsSnapshot(Outbound):
    payload_json: str

    def canonical(self) -> dict:
        return {'duo_visitors': self.payload_json}


@_register
@dataclass(frozen=True)
class Visitor(Outbound):
    section: str
    item_json: str
    last_visited_at: str | None = None

    def canonical(self) -> dict:
        attrs: dict = {'@section': self.section}
        if self.last_visited_at is not None:
            attrs['@last_visited_at'] = self.last_visited_at
        attrs['#text'] = self.item_json
        return {'duo_visitor': attrs}


@_register
@dataclass(frozen=True)
class MessageBlocked(Outbound):
    stanza_id: str
    reason: str | None = None
    subreason: str | None = None

    def canonical(self) -> dict:
        attrs: dict = {'@id': self.stanza_id}
        if self.reason is not None:
            attrs['@reason'] = self.reason
        if self.subreason is not None:
            attrs['@subreason'] = self.subreason
        return {'duo_message_blocked': attrs}


@_register
@dataclass(frozen=True)
class MessageTooLong(Outbound):
    stanza_id: str

    def canonical(self) -> dict:
        return {'duo_message_too_long': {'@id': self.stanza_id}}


@_register
@dataclass(frozen=True)
class MessageNotUnique(Outbound):
    stanza_id: str
    used_count: int

    def canonical(self) -> dict:
        return {'duo_message_not_unique': {
            '@id': self.stanza_id,
            '@used_count': str(self.used_count),
        }}


@_register
@dataclass(frozen=True)
class MessageDelivered(Outbound):
    stanza_id: str
    stamp: str
    audio_uuid: str | None = None
    mam_id: str | None = None

    def canonical(self) -> dict:
        attrs: dict = {'@id': self.stanza_id}
        if self.audio_uuid is not None:
            attrs['@audio_uuid'] = self.audio_uuid
        if self.mam_id is not None:
            attrs['@mam_id'] = self.mam_id
        attrs['@stamp'] = self.stamp
        return {'duo_message_delivered': attrs}


@_register
@dataclass(frozen=True)
class ServerError(Outbound):
    stanza_id: str

    def canonical(self) -> dict:
        return {'duo_server_error': {'@id': self.stanza_id}}


@_register
@dataclass(frozen=True)
class StreamClose(Outbound):
    def canonical(self) -> dict:
        return {'stream': None}


# --------------------------------------------------------------------------- #
# Structured stanzas                                                          #
# --------------------------------------------------------------------------- #

@_register
@dataclass(frozen=True)
class IncomingChat(Outbound):
    from_username: str
    to_username: str
    stanza_id: str
    body: str
    audio_uuid: str | None = None
    mam_id: str | None = None

    def canonical(self) -> dict:
        message: dict = {
            '@xmlns': NS_CLIENT,
            '@from': _jid(self.from_username),
            '@to': _jid(self.to_username),
            '@id': self.stanza_id,
            '@type': 'chat',
        }
        if self.audio_uuid is not None:
            message['@audio_uuid'] = self.audio_uuid
        if self.mam_id is not None:
            message['@mam_id'] = self.mam_id
        message['body'] = self.body
        message['request'] = {'@xmlns': NS_RECEIPTS}
        return {'message': message}


@_register
@dataclass(frozen=True)
class IncomingTyping(Outbound):
    from_username: str
    to_username: str
    stanza_id: str

    def canonical(self) -> dict:
        return {'message': {
            '@xmlns': NS_CLIENT,
            '@from': _jid(self.from_username),
            '@to': _jid(self.to_username),
            '@id': self.stanza_id,
            '@type': 'typing',
        }}


@_register
@dataclass(frozen=True)
class ReadReceipt(Outbound):
    from_username: str
    to_username: str
    stamp: str | None = None

    def canonical(self) -> dict:
        displayed: dict = {'@xmlns': NS_CHAT_MARKERS}
        if self.stamp is not None:
            displayed['@stamp'] = self.stamp
        return {'message': {
            '@xmlns': NS_CLIENT,
            '@from': _jid(self.from_username),
            '@to': _jid(self.to_username),
            '@type': 'read-receipt',
            'displayed': displayed,
        }}


@_register
@dataclass(frozen=True)
class IncomingReaction(Outbound):
    from_username: str
    to_username: str
    mam_id: str
    emoji: str
    stamp: str

    def canonical(self) -> dict:
        return {'duo_reaction': {
            '@from': _jid(self.from_username),
            '@to': _jid(self.to_username),
            '@mam_id': self.mam_id,
            '@emoji': self.emoji,
            '@stamp': self.stamp,
        }}


@_register
@dataclass(frozen=True)
class ReactionDelivered(Outbound):
    stanza_id: str
    stamp: str

    def canonical(self) -> dict:
        return {'duo_reaction_delivered': {
            '@id': self.stanza_id,
            '@stamp': self.stamp,
        }}


@_register
@dataclass(frozen=True)
class ReactionBlocked(Outbound):
    stanza_id: str

    def canonical(self) -> dict:
        return {'duo_reaction_blocked': {'@id': self.stanza_id}}


@_register
@dataclass(frozen=True)
class MamResult(Outbound):
    viewer_username: str
    query_id: str
    result_id: str
    forwarded_id: str
    stamp: str
    msg_from_username: str
    msg_to_username: str
    stanza_id: str | None
    body: str
    audio_uuid: str | None = None
    reaction: str | None = None
    reaction_from: str | None = None

    def canonical(self) -> dict:
        inner: dict = {
            '@xmlns': NS_CLIENT,
            '@from': _jid(self.msg_from_username),
        }
        if self.stanza_id is not None:
            inner['@id'] = self.stanza_id
        inner['@to'] = _jid(self.msg_to_username)
        inner['@type'] = 'chat'
        if self.audio_uuid is not None:
            inner['@audio_uuid'] = self.audio_uuid
        if self.reaction is not None:
            inner['@reaction'] = self.reaction
            inner['@reaction_from'] = self.reaction_from
        inner['body'] = self.body
        inner['request'] = {'@xmlns': NS_RECEIPTS}

        forwarded = {
            '@xmlns': NS_FORWARD,
            'delay': {'@xmlns': NS_DELAY, '@stamp': self.stamp},
            'message': inner,
        }
        result = {
            '@xmlns': NS_MAM,
            '@queryid': self.query_id,
            '@id': self.result_id,
            'forwarded': forwarded,
        }
        return {'message': {
            '@xmlns': NS_CLIENT,
            '@from': _jid(self.viewer_username),
            '@to': _jid(self.viewer_username),
            '@id': self.forwarded_id,
            'result': result,
        }}


@_register
@dataclass(frozen=True)
class MamFin(Outbound):
    viewer_username: str
    query_id: str

    def canonical(self) -> dict:
        return {'iq': {
            '@xmlns': NS_CLIENT,
            '@from': _jid(self.viewer_username),
            '@to': _jid(self.viewer_username),
            '@id': self.query_id,
            '@type': 'result',
            'fin': {'@xmlns': NS_MAM},
        }}


@_register
@dataclass(frozen=True)
class InboxResult(Outbound):
    owner_username: str
    msg_id: str
    inner_from_username: str
    inner_to_username: str
    body: str
    stamp: str
    unread_count: int
    box: str
    query_id: str
    muted_until: object = 0

    def canonical(self) -> dict:
        inner = {
            '@xmlns': NS_CLIENT,
            '@from': _jid(self.inner_from_username),
            '@to': _jid(self.inner_to_username),
            '@id': f'{self.msg_id}',
            '@type': 'chat',
            'body': self.body,
            'request': {'@xmlns': NS_RECEIPTS},
        }
        forwarded = {
            '@xmlns': NS_FORWARD,
            'delay': {'@xmlns': NS_DELAY, '@stamp': self.stamp},
            'message': inner,
        }
        result = {
            '@xmlns': NS_INBOX,
            '@unread': str(self.unread_count),
            '@queryid': self.query_id,
            'forwarded': forwarded,
            'read': 'true' if self.unread_count == 0 else 'false',
            'box': self.box,
            'archive': 'false',
            'mute': str(self.muted_until),
        }
        user_jid = _jid(self.owner_username)
        return {'message': {
            '@xmlns': NS_CLIENT,
            '@from': user_jid,
            '@to': user_jid,
            '@id': f'{self.msg_id}',
            'result': result,
        }}


@_register
@dataclass(frozen=True)
class InboxFin(Outbound):
    query_id: str

    def canonical(self) -> dict:
        return {'iq': {
            '@id': self.query_id,
            '@type': 'result',
            'fin': None,
        }}


@dataclass(frozen=True)
class InboxConversation(TypedDict):
    """
    The wire shape of one inbox conversation: the whole of an `InboxEntry`
    payload, and each element of an `InboxSnapshot` payload's `conversations`.
    This is the single source of truth for that shape; the rows it's assembled
    from come from `Q_INBOX_SNAPSHOT`/`Q_INBOX_ENTRY` in
    `service.chat.messagestorage.inbox`.
    """
    person_uuid: str
    url_slug: str | None
    name: str | None
    match_percentage: int | None
    image_uuid: str | None
    image_blurhash: str | None
    is_verified: bool
    is_available: bool
    location: str
    last_message: str
    last_message_read: bool
    last_message_timestamp: str


@dataclass(frozen=True)
class InboxSnapshotPayload(TypedDict):
    conversations: list[InboxConversation]


@_register
@dataclass(frozen=True)
class InboxSnapshot(Outbound):
    """
    The response to `duo_query_inbox`: a JSON object of the form
    `{"conversations": [...]}` where each conversation is complete (last
    message, unread state and person info), replacing the legacy
    `InboxResult`/`InboxFin` stream plus `/inbox-info` join.
    """
    payload: InboxSnapshotPayload

    def canonical(self) -> dict:
        return {'duo_inbox': self.payload}


@_register
@dataclass(frozen=True)
class InboxEntry(Outbound):
    """
    A single conversation in the same shape as `InboxSnapshot`'s entries,
    pushed to the recipient when a message arrives so their client can update
    its inbox without any further requests.
    """
    payload: InboxConversation

    def canonical(self) -> dict:
        return {'duo_inbox_entry': self.payload}


# --------------------------------------------------------------------------- #
# Session / handshake stanzas                                                 #
# --------------------------------------------------------------------------- #

@_register
@dataclass(frozen=True)
class StreamOpenResponse(Outbound):
    version: str
    id: str
    from_: str

    def canonical(self) -> dict:
        return {'open': {
            '@xmlns': NS_FRAMING,
            '@version': self.version,
            '@id': self.id,
            '@from': self.from_,
        }}


@_register
@dataclass(frozen=True)
class StreamFeatures(Outbound):
    authenticated: bool

    def canonical(self) -> dict:
        if self.authenticated:
            return {'features': {
                '@xmlns': NS_STREAMS,
                'session': {'@xmlns': NS_SESSION},
                'bind': {'@xmlns': NS_BIND},
            }}
        return {'features': {
            '@xmlns': NS_STREAMS,
            'starttls': {'@xmlns': NS_TLS},
            'mechanisms': {'@xmlns': NS_SASL, 'mechanism': 'PLAIN'},
        }}


@_register
@dataclass(frozen=True)
class AuthSuccess(Outbound):
    def canonical(self) -> dict:
        return {'success': {'@xmlns': NS_SASL}}


@_register
@dataclass(frozen=True)
class AuthFailure(Outbound):
    def canonical(self) -> dict:
        return {'failure': {'@xmlns': NS_SASL, 'not-authorized': None}}


@_register
@dataclass(frozen=True)
class BindResult(Outbound):
    iq_id: str
    jid: str

    def canonical(self) -> dict:
        return {'iq': {
            '@type': 'result',
            '@id': self.iq_id,
            'bind': {'@xmlns': NS_BIND, 'jid': self.jid},
        }}


@_register
@dataclass(frozen=True)
class SessionResult(Outbound):
    iq_id: str

    def canonical(self) -> dict:
        return {'iq': {'@type': 'result', '@id': self.iq_id}}
