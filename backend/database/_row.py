from collections.abc import Mapping
from typing import TypeVar
from util.coerce import (
    boolean,
    integer,
    optional_int,
    optional_int_list,
    optional_str,
    string,
    string_list,
)


RowT = TypeVar('RowT')


def require_row(row: RowT | None) -> RowT:
    if row is None:
        raise RuntimeError('query returned no row')
    return row


def row_value(row: Mapping[str, object], key: str) -> object:
    return row[key]


def row_bool(row: Mapping[str, object], key: str) -> bool:
    return boolean(row_value(row, key), key)


def row_int(row: Mapping[str, object], key: str) -> int:
    return integer(row_value(row, key), key)


def row_str(row: Mapping[str, object], key: str) -> str:
    return string(row_value(row, key), key)


def row_int_or_none(row: Mapping[str, object], key: str) -> int | None:
    return optional_int(row_value(row, key), key)


def row_str_or_none(row: Mapping[str, object], key: str) -> str | None:
    return optional_str(row_value(row, key), key)


def row_str_list(row: Mapping[str, object], key: str) -> list[str]:
    return string_list(row_value(row, key), key)


def row_int_list_or_none(row: Mapping[str, object], key: str) -> list[int] | None:
    return optional_int_list(row_value(row, key), key)
