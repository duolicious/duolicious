def sent_messages_in_chats(person_id: int) -> bool:
    return 390250 <= person_id < 391550 and person_id % 2 == 0


def hide_rude_intros(person_id: int) -> bool:
    return person_id >= 391600 and person_id % 2 == 0
