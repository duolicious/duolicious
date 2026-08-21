"""
A minimal, immutable element model used only at the client<->server boundary.

Inbound JSON (in the xmltodict-style shape) is normalized into `Element` trees,
which the interpreter in `inbound.py` turns into semantic dataclasses. Business
logic never sees raw JSON.

Child lookups match on local name only (ignoring namespace), mirroring the
`local-name()` XPath style the protocol relies on.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field


# XMPP namespaces referenced by the interpreter.
NS_FRAMING = 'urn:ietf:params:xml:ns:xmpp-framing'
NS_SASL = 'urn:ietf:params:xml:ns:xmpp-sasl'
NS_BIND = 'urn:ietf:params:xml:ns:xmpp-bind'
NS_SESSION = 'urn:ietf:params:xml:ns:xmpp-session'
NS_CLIENT = 'jabber:client'


@dataclass(frozen=True)
class Element:
    tag: str
    ns: str | None = None
    attrib: tuple[tuple[str, str], ...] = ()
    text: str | None = None
    children: tuple['Element', ...] = field(default_factory=tuple)

    def get(self, name: str) -> str | None:
        for key, value in self.attrib:
            if key == name:
                return value
        return None

    def find(self, localname: str) -> 'Element | None':
        for child in self.children:
            if child.tag == localname:
                return child
        return None

    def findall(self, localname: str) -> list['Element']:
        return [child for child in self.children if child.tag == localname]

    def descendant(self, localname: str) -> 'Element | None':
        for el in self.iter():
            if el is not self and el.tag == localname:
                return el
        return None

    def descendants(self, localname: str) -> list['Element']:
        return [el for el in self.iter() if el is not self and el.tag == localname]

    def iter(self) -> 'list[Element]':
        result = [self]
        for child in self.children:
            result.extend(child.iter())
        return result


def _scalar_to_str(value: object) -> str:
    if isinstance(value, bool):
        return 'true' if value else 'false'
    return str(value)


def _from_json_value(tag: str, value: object) -> Element:
    ns: str | None = None
    attrib: list[tuple[str, str]] = []
    text: str | None = None
    children: list[Element] = []

    if isinstance(value, dict):
        for key, item in value.items():
            if key == '@xmlns':
                ns = _scalar_to_str(item)
            elif key.startswith('@'):
                attrib.append((key[1:], _scalar_to_str(item)))
            elif key == '#text':
                text = _scalar_to_str(item)
            elif isinstance(item, list):
                for entry in item:
                    children.append(_from_json_value(key, entry))
            else:
                children.append(_from_json_value(key, item))
    elif value is None:
        pass
    else:
        text = _scalar_to_str(value)

    return Element(
        tag=tag,
        ns=ns,
        attrib=tuple(attrib),
        text=text,
        children=tuple(children),
    )


def element_from_json(text: str) -> Element | None:
    try:
        obj = json.loads(text)
    except Exception:
        return None

    if not isinstance(obj, dict) or len(obj) != 1:
        return None

    (tag, value), = obj.items()

    return _from_json_value(tag, value)
