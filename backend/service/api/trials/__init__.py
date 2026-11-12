_FIRST_PERSON_ID = 399000


def _treated(
    person_id: int,
    bit: int,
    first_person_id: int = _FIRST_PERSON_ID,
) -> bool:
    return person_id >= first_person_id and (person_id >> bit) % 2 == 0


def messages_received_sort_until_answered(person_id: int) -> bool:
    return _treated(person_id, bit=0, first_person_id=400050)


def no_message_count_filter_in_feed(person_id: int) -> bool:
    return _treated(person_id, bit=1)


def web_push_when_offline(person_id: int) -> bool:
    return _treated(person_id, bit=2)
