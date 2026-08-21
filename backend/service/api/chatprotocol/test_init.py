import json
import unittest

from service.api.chatprotocol.jid import LSERVER
from service.api.chatprotocol.mam_id import decode_mam_id
from service.api.chatprotocol.message import (
    AudioMessage,
    ChatMessage,
    ReactionMessage,
    TypingMessage,
)
from service.api.chatprotocol import outbound
from service.api.chatprotocol.inbound import (
    InboxQuery,
    InboxSnapshotQuery,
    IqBind,
    IqSession,
    MamQuery,
    MarkDisplayed,
    MarkVisitorsChecked,
    Ping,
    RegisterPushToken,
    RegisterWebPushSubscription,
    SaslAuth,
    StreamOpenReq,
    SubscribeOnline,
    UnsubscribeOnline,
    VisitorsQuery,
    parse_incoming,
)
from service.api.chatprotocol.outbound import (
    AuthFailure,
    AuthSuccess,
    BindResult,
    InboxConversation,
    InboxEntry,
    InboxFin,
    InboxResult,
    InboxSnapshot,
    InboxSnapshotPayload,
    IncomingChat,
    IncomingReaction,
    IncomingTyping,
    MamFin,
    MamResult,
    MessageBlocked,
    MessageDelivered,
    MessageNotUnique,
    MessageTooLong,
    OnlineEvent,
    Pong,
    ReactionBlocked,
    ReactionDelivered,
    ReadReceipt,
    RegistrationSuccessful,
    ServerError,
    SessionResult,
    StreamClose,
    StreamFeatures,
    StreamOpenResponse,
    SubscribeBad,
    SubscribeOk,
    UnsubscribeBad,
    UnsubscribeOk,
    Visitor,
    VisitorsSnapshot,
    from_bus,
    to_bus,
)

U1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
U2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

_VISITOR_ITEM_JSON = json.dumps({
    'person_uuid': U2,
    'name': 'Alé & <co>',
    'age': 25,
    'is_new': True,
    'match_percentage': 50,
})
_VISITORS_PAYLOAD_JSON = json.dumps({
    'visited_you': [],
    'you_visited': [],
    'last_visited_at': None,
})
_INBOX_CONVERSATION: InboxConversation = {
    'person_uuid': U2,
    'url_slug': 'some-slug',
    'name': 'Alé & <co>',
    'match_percentage': 50,
    'image_uuid': None,
    'image_blurhash': None,
    'is_verified': False,
    'is_available': True,
    'location': 'intros',
    'matches_search_filters': True,
    'last_message': 'hi',
    'last_message_read': False,
    'last_message_timestamp': '2020-01-01T00:00:00.000000Z',
}
_INBOX_PAYLOAD: InboxSnapshotPayload = {
    'conversations': [_INBOX_CONVERSATION],
}

# One representative instance of every outbound stanza.
OUTBOUND_SAMPLES = [
    Pong(),
    RegistrationSuccessful(),
    SubscribeOk(username=U1),
    SubscribeBad(username=U1),
    UnsubscribeOk(username=U1),
    UnsubscribeBad(username=U1),
    OnlineEvent(username=U1, status='online'),
    OnlineEvent(username=U1, status='online-recently', seconds_ago=0),
    OnlineEvent(username=U1, status='online-recently', seconds_ago=3600),
    VisitorsSnapshot(payload_json=_VISITORS_PAYLOAD_JSON),
    Visitor(section='visited_you', item_json=_VISITOR_ITEM_JSON),
    Visitor(
        section='you_visited',
        item_json=_VISITOR_ITEM_JSON,
        last_visited_at='2020-01-01T00:00:00.000000Z'),
    MessageBlocked(stanza_id='id1'),
    MessageBlocked(stanza_id='id1', reason='spam'),
    MessageBlocked(stanza_id='id1', reason='rate-limited-1day', subreason='unverified-photos'),
    MessageTooLong(stanza_id='id1'),
    MessageNotUnique(stanza_id='id2', used_count=1),
    MessageDelivered(stanza_id='id1', stamp='2020-01-01T00:00:00.000000Z'),
    MessageDelivered(stanza_id='id1', stamp='2020-01-01T00:00:00.000000Z', audio_uuid='au'),
    MessageDelivered(stanza_id='id1', stamp='2020-01-01T00:00:00.000000Z', mam_id='ABCD'),
    ServerError(stanza_id='id1'),
    IncomingChat(from_username=U1, to_username=U2, stanza_id='id1', body='hi'),
    IncomingChat(from_username=U1, to_username=U2, stanza_id='id1', body='hi', audio_uuid='au'),
    IncomingChat(from_username=U1, to_username=U2, stanza_id='id1', body='hi', mam_id='ABCD'),
    IncomingTyping(from_username=U1, to_username=U2, stanza_id='id1'),
    IncomingReaction(
        from_username=U1, to_username=U2, mam_id='ABCD', emoji='❤️',
        stamp='2020-01-01T00:00:00.000000Z'),
    IncomingReaction(
        from_username=U1, to_username=U2, mam_id='ABCD', emoji='',
        stamp='2020-01-01T00:00:00.000000Z'),
    ReactionDelivered(stanza_id='id1', stamp='2020-01-01T00:00:00.000000Z'),
    ReactionBlocked(stanza_id='id1'),
    ReadReceipt(from_username=U1, to_username=U2),
    ReadReceipt(from_username=U1, to_username=U2, stamp='2020-01-01T00:00:00.000000Z'),
    MamResult(
        viewer_username=U1, query_id='7', result_id='ABCD', forwarded_id='fwd',
        stamp='2020-01-01T00:00:00.000000Z', msg_from_username=U1,
        msg_to_username=U2, stanza_id='id1', body='hi'),
    MamResult(
        viewer_username=U1, query_id='7', result_id='ABCD', forwarded_id='fwd',
        stamp='2020-01-01T00:00:00.000000Z', msg_from_username=U1,
        msg_to_username=U2, stanza_id='id1', body='hi', audio_uuid='au'),
    MamResult(
        viewer_username=U1, query_id='7', result_id='ABCD', forwarded_id='fwd',
        stamp='2020-01-01T00:00:00.000000Z', msg_from_username=U1,
        msg_to_username=U2, stanza_id='id1', body='hi',
        reaction='\U0001f44d', reaction_from='self'),
    MamFin(viewer_username=U1, query_id='7'),
    InboxResult(
        owner_username=U1, msg_id='123', inner_from_username=U1,
        inner_to_username=U2, body='hi', stamp='2020-01-01T00:00:00.000000Z',
        unread_count=0, box='chats', query_id='q1', muted_until=0),
    InboxResult(
        owner_username=U1, msg_id='123', inner_from_username=U2,
        inner_to_username=U1, body='hi', stamp='2020-01-01T00:00:00.000000Z',
        unread_count=2, box='inbox', query_id='q1', muted_until=0),
    InboxFin(query_id='q1'),
    InboxSnapshot(payload=_INBOX_PAYLOAD),
    InboxEntry(payload=_INBOX_CONVERSATION),
    StreamOpenResponse(version='1.0', id='oid', from_=LSERVER),
    StreamFeatures(authenticated=False),
    StreamFeatures(authenticated=True),
    AuthSuccess(),
    AuthFailure(),
    BindResult(iq_id='b1', jid=f'{U1}@{LSERVER}'),
    SessionResult(iq_id='s1'),
    StreamClose(),
]


class TestOutbound(unittest.TestCase):
    def test_to_json_round_trips_canonical(self) -> None:
        # `to_json()` is the only wire rendering; it must faithfully serialize
        # the canonical dict every stanza declares.
        for sample in OUTBOUND_SAMPLES:
            with self.subTest(stanza=type(sample).__name__):
                self.assertEqual(json.loads(sample.to_json()), sample.canonical())

    def test_online_event_reports_its_age(self) -> None:
        event = OnlineEvent(
            username=U1, status='online-recently', seconds_ago=7200)

        self.assertEqual(
            event.canonical()['duo_online_event']['@seconds_ago'], '7200')

    def test_online_event_omits_an_absent_age(self) -> None:
        event = OnlineEvent(username=U1, status='online-recently')

        self.assertNotIn('@seconds_ago', event.canonical()['duo_online_event'])

    def test_bus_round_trip(self) -> None:
        for sample in OUTBOUND_SAMPLES:
            with self.subTest(stanza=type(sample).__name__):
                self.assertEqual(from_bus(to_bus(sample)), sample)

    def test_bus_ignores_unknown_fields(self) -> None:
        serialized = json.dumps({
            'kind': 'ServerError',
            'stanza_id': 'id1',
            'field_from_the_future': 'ignored',
        })
        self.assertEqual(from_bus(serialized), ServerError(stanza_id='id1'))


class TestInboundParsing(unittest.TestCase):
    def test_ping(self) -> None:
        self.assertEqual(parse_incoming('{"duo_ping": null}'), Ping())

    def test_auth(self) -> None:
        js = ('{"auth": {"@xmlns": "urn:ietf:params:xml:ns:xmpp-sasl", '
              '"@mechanism": "PLAIN", "#text": "QUJD"}}')
        self.assertEqual(parse_incoming(js), SaslAuth(payload_b64='QUJD'))

    def test_subscribe(self) -> None:
        js = f'{{"duo_subscribe_online": {{"@uuid": "{U2}"}}}}'
        self.assertEqual(parse_incoming(js), SubscribeOnline(uuid=U2))

    def test_unsubscribe(self) -> None:
        js = f'{{"duo_unsubscribe_online": {{"@uuid": "{U2}"}}}}'
        self.assertEqual(parse_incoming(js), UnsubscribeOnline(uuid=U2))

    def test_register_push_token(self) -> None:
        js = '{"duo_register_push_token": {"@token": "t1"}}'
        self.assertEqual(parse_incoming(js), RegisterPushToken(token='t1'))

    def test_register_push_token_clear(self) -> None:
        js = '{"duo_register_push_token": null}'
        self.assertEqual(parse_incoming(js), RegisterPushToken(token=None))

    def test_register_web_push_subscription(self) -> None:
        js = '{"duo_register_web_push_subscription": {"@subscription": "{}"}}'
        self.assertEqual(
            parse_incoming(js),
            RegisterWebPushSubscription(subscription='{}'))

    def test_register_web_push_subscription_clear(self) -> None:
        js = '{"duo_register_web_push_subscription": null}'
        self.assertEqual(
            parse_incoming(js),
            RegisterWebPushSubscription(subscription=None))

    def test_chat_message(self) -> None:
        js = (
            f'{{"message": {{"@type": "chat", "@from": "{U1}@{LSERVER}", '
            f'"@to": "{U2}@{LSERVER}", "@id": "id1", "@xmlns": "jabber:client", '
            f'"body": "hello", "request": {{"@xmlns": "urn:xmpp:receipts"}}}}}}')
        self.assertEqual(
            parse_incoming(js),
            ChatMessage(stanza_id='id1', to_username=U2, body='hello'))

    def test_typing_message(self) -> None:
        js = (
            f'{{"message": {{"@type": "typing", "@from": "{U1}@{LSERVER}", '
            f'"@to": "{U2}@{LSERVER}", "@id": "id1", "@xmlns": "jabber:client"}}}}')
        self.assertEqual(
            parse_incoming(js),
            TypingMessage(stanza_id='id1', to_username=U2))

    def test_audio_message_is_audio(self) -> None:
        js = (
            f'{{"message": {{"@type": "chat", "@from": "{U1}@{LSERVER}", '
            f'"@to": "{U2}@{LSERVER}", "@id": "id1", "@audio_base64": "QQ==", '
            f'"@xmlns": "jabber:client"}}}}')
        msg = parse_incoming(js)
        assert isinstance(msg, AudioMessage)
        self.assertEqual(msg.audio_base64, 'QQ==')

    def test_reaction(self) -> None:
        js = (
            f'{{"duo_reaction": {{"@to": "{U2}@{LSERVER}", "@id": "r1", '
            f'"@mam_id": "ABCD", "@emoji": "❤️"}}}}')
        target_mam_message_id = decode_mam_id('ABCD')
        assert target_mam_message_id is not None
        self.assertEqual(
            parse_incoming(js),
            ReactionMessage(
                stanza_id='r1',
                target_mam_message_id=target_mam_message_id,
                emoji='❤️'))

    def test_reaction_target_is_mam_id_not_to_jid(self) -> None:
        js = ('{"duo_reaction": {"@id": "r1", "@mam_id": "ABCD", '
              '"@emoji": "❤️"}}')
        target_mam_message_id = decode_mam_id('ABCD')
        assert target_mam_message_id is not None
        self.assertEqual(
            parse_incoming(js),
            ReactionMessage(
                stanza_id='r1',
                target_mam_message_id=target_mam_message_id,
                emoji='❤️'))

    def test_reaction_clear(self) -> None:
        js = (
            f'{{"duo_reaction": {{"@to": "{U2}@{LSERVER}", "@id": "r1", '
            f'"@mam_id": "ABCD", "@emoji": ""}}}}')
        target_mam_message_id = decode_mam_id('ABCD')
        assert target_mam_message_id is not None
        self.assertEqual(
            parse_incoming(js),
            ReactionMessage(
                stanza_id='r1',
                target_mam_message_id=target_mam_message_id,
                emoji=''))

    def test_reaction_rejects_bad_mam_id(self) -> None:
        # 'W' is outside the base-32 alphabet (0-9, A-V).
        js = (
            f'{{"duo_reaction": {{"@to": "{U2}@{LSERVER}", "@id": "r1", '
            f'"@mam_id": "WXYZ", "@emoji": "❤"}}}}')
        self.assertIsNone(parse_incoming(js))

    def test_reaction_rejects_signed_mam_id(self) -> None:
        js = (
            f'{{"duo_reaction": {{"@to": "{U2}@{LSERVER}", "@id": "r1", '
            f'"@mam_id": "-1", "@emoji": "❤"}}}}')
        self.assertIsNone(parse_incoming(js))

    def test_reaction_rejects_ascii_emoji(self) -> None:
        js = (
            f'{{"duo_reaction": {{"@to": "{U2}@{LSERVER}", "@id": "r1", '
            f'"@mam_id": "ABCD", "@emoji": "lol"}}}}')
        self.assertIsNone(parse_incoming(js))

    def test_mark_displayed(self) -> None:
        js = (
            f'{{"message": {{"@from": "{U1}@{LSERVER}", "@to": "{U2}@{LSERVER}", '
            f'"@xmlns": "jabber:client", "displayed": '
            f'{{"@xmlns": "urn:xmpp:chat-markers:0"}}}}}}')
        self.assertEqual(parse_incoming(js), MarkDisplayed(to_username=U2))

    def test_mam_query(self) -> None:
        js = (
            f'{{"iq": {{"@type": "set", "@id": "7", "query": '
            f'{{"@xmlns": "urn:xmpp:mam:2", "@queryid": "7", "x": '
            f'{{"@xmlns": "jabber:x:data", "@type": "submit", "field": '
            f'{{"@var": "with", "value": "{U2}@{LSERVER}"}}}}, "set": '
            f'{{"@xmlns": "http://jabber.org/protocol/rsm", "max": "3", '
            f'"before": ""}}}}}}}}')
        self.assertEqual(
            parse_incoming(js),
            MamQuery(query_id='7', with_username=U2, before=None, max='3'))

    def test_query_visitors(self) -> None:
        self.assertEqual(
            parse_incoming('{"duo_query_visitors": null}'), VisitorsQuery())

    def test_mark_visitors_checked(self) -> None:
        js = ('{"duo_mark_visitors_checked": '
              '{"@when": "2020-01-01T00:00:00.000000Z"}}')
        self.assertEqual(
            parse_incoming(js),
            MarkVisitorsChecked(when='2020-01-01T00:00:00.000000Z'))

    def test_mark_visitors_checked_no_when(self) -> None:
        self.assertEqual(
            parse_incoming('{"duo_mark_visitors_checked": null}'),
            MarkVisitorsChecked(when=None))

    def test_inbox_snapshot_query(self) -> None:
        self.assertEqual(
            parse_incoming('{"duo_query_inbox": null}'), InboxSnapshotQuery())

    def test_inbox_query(self) -> None:
        js = (
            '{"iq": {"@type": "set", "@id": "5", "inbox": '
            '{"@xmlns": "erlang-solutions.com:xmpp:inbox:0", "@queryid": "5", '
            '"x": {"@xmlns": "jabber:x:data", "@type": "form"}}}}')
        self.assertEqual(parse_incoming(js), InboxQuery(query_id='5'))

    def test_iq_bind(self) -> None:
        js = (
            '{"iq": {"@xmlns": "jabber:client", "@type": "set", "@id": "b1", '
            '"bind": {"@xmlns": "urn:ietf:params:xml:ns:xmpp-bind"}}}')
        self.assertEqual(parse_incoming(js), IqBind(iq_id='b1'))

    def test_open(self) -> None:
        js = (
            '{"open": {"@xmlns": "urn:ietf:params:xml:ns:xmpp-framing", '
            f'"@version": "1.0", "@to": "{LSERVER}"}}}}')
        self.assertEqual(
            parse_incoming(js), StreamOpenReq(version='1.0', to=LSERVER))


if __name__ == '__main__':
    unittest.main()
