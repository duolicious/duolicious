"""
The base-32 mam_message.id wire codec.

Kept in the protocol layer (free of database/redis imports) so inbound
validation and the service layer share a single definition of the format.
"""
import re


MAX_MAM_ID_LEN = 16
_MAM_ID_RE = re.compile(rf'^[0-9A-V]{{1,{MAX_MAM_ID_LEN}}}$')


def _int_to_mam_id_base32(number: int) -> str:
    if number == 0:
        return "0"

    digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    result = []
    while number:
        number, rem = divmod(number, 32)
        result.append(digits[rem])

    return "".join(reversed(result))


def _mam_id_base32_to_int(mam_id: str) -> int:
    return int(mam_id, 32)


def encode_mam_id(mam_id: int) -> str:
    if mam_id < 0:
        raise ValueError(mam_id)

    return _int_to_mam_id_base32(mam_id)


def decode_mam_id(mam_id: str) -> int | None:
    if _MAM_ID_RE.fullmatch(mam_id) is None:
        return None

    return _mam_id_base32_to_int(mam_id)
