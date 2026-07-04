"""
The chat wire-protocol layer: stanza parsing/serialisation (`inbound`,
`outbound`, `element`) plus the dependency-light primitives they need (`jid`,
`message`).

This deliberately lives OUTSIDE the `service.chat` package. Importing anything
under `service.chat` runs `service/chat/__init__.py`, which boots the whole chat
FastAPI app (it creates `app = FastAPI()` and a Redis client at import time).
Keeping the protocol here -- with no module-level side effects and no
database/redis imports -- lets the synchronous Flask API (e.g. `visitorspush`)
import the real `Outbound` stanzas and `to_bus` without dragging in the server,
so the live-push and snapshot paths share one source of truth.
"""
from chatprotocol.element import Element
from chatprotocol.inbound import (
    InboxQuery,
    InboxSnapshotQuery,
    IqBind,
    IqSession,
    MamQuery,
    MarkDisplayed,
    MarkVisitorsChecked,
    Ping,
    RegisterPushToken,
    SaslAuth,
    SessionRequest,
    StreamOpenReq,
    SubscribeOnline,
    UnsubscribeOnline,
    VisitorsQuery,
    parse_incoming,
)
from chatprotocol import outbound
from chatprotocol.outbound import Outbound, from_bus, to_bus
