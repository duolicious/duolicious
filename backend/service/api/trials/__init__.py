def _treated(person_id: int, first_person_id: int, bit: int) -> bool:
    return person_id >= first_person_id and (person_id >> bit) % 2 == 0


def sent_messages_in_chats(person_id: int) -> bool:
    return _treated(person_id, first_person_id=389200, bit=2)
