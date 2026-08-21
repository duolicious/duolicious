"""
The chat wire-protocol layer: stanza parsing/serialisation (`inbound`,
`outbound`, `element`) plus the dependency-light primitives they need (`jid`,
`message`).

This deliberately lives OUTSIDE the `service.api.chat` package. Importing anything
under `service.api.chat` runs `service/api/chat/__init__.py`, which creates a Redis
client (and drags in the database layer) at import time.
Keeping the protocol here -- with no module-level side effects and no
database/redis imports -- lets the synchronous Flask API (e.g. `visitorspush`)
import the real `Outbound` stanzas and `to_bus` without dragging in the server,
so the live-push and snapshot paths share one source of truth.
"""
from service.api.chatprotocol.element import Element
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
    SessionRequest,
    StreamOpenReq,
    SubscribeOnline,
    UnsubscribeOnline,
    VisitorsQuery,
    parse_incoming,
)
from service.api.chatprotocol import outbound
from service.api.chatprotocol.outbound import Outbound, from_bus, to_bus
