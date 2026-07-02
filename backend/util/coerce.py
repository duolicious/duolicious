from collections.abc import Mapping, Sequence
from typing import cast


def _message(expected: str, field_name: str | None) -> str:
    if field_name is None:
        return f'expected {expected}'
    return f'{field_name} must be {expected}'


def boolean(value: object, field_name: str | None = None) -> bool:
    if not isinstance(value, bool):
        raise RuntimeError(_message('a boolean', field_name))
    return value


def integer(value: object, field_name: str | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise RuntimeError(_message('an integer', field_name))
    return value


def number(value: object, field_name: str | None = None) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RuntimeError(_message('number', field_name))
    return value


def number_or_zero(value: object) -> int | float:
    if value is None:
        return 0
    return number(value)


def string(value: object, field_name: str | None = None) -> str:
    if not isinstance(value, str):
        raise RuntimeError(_message('a string', field_name))
    return value


def optional_int(value: object, field_name: str | None = None) -> int | None:
    if value is None:
        return None
    return integer(value, field_name)


def optional_str(value: object, field_name: str | None = None) -> str | None:
    if value is None or isinstance(value, str):
        return value
    raise RuntimeError(_message('a string or None', field_name))


def string_list(value: object, field_name: str | None = None) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
        raise RuntimeError(_message('a list of strings', field_name))
    return cast(list[str], value)


def mapping(value: object, field_name: str | None = None) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise RuntimeError(_message('mapping', field_name))
    return value


def mapping_or_empty(value: object) -> Mapping[str, object]:
    if value is None:
        return {}
    return mapping(value)


def mapping_sequence(
    value: object,
    field_name: str | None = None,
) -> Sequence[Mapping[str, object]]:
    if not isinstance(value, list):
        raise RuntimeError(_message('sequence of mappings', field_name))
    if not all(isinstance(item, dict) for item in value):
        raise RuntimeError(_message('sequence of mappings', field_name))
    return value


def mapping_sequence_or_empty(value: object) -> Sequence[Mapping[str, object]]:
    if value is None:
        return []
    return mapping_sequence(value)


def sequence(value: object, field_name: str | None = None) -> Sequence[object]:
    if not isinstance(value, list):
        raise RuntimeError(_message('sequence', field_name))
    return value


def sequence_or_empty(value: object) -> Sequence[object]:
    if value is None:
        return []
    return sequence(value)
