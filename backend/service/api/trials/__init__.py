_FIRST_PERSON_ID = 387800


def _treated(person_id: int, bit: int) -> bool:
    return person_id >= _FIRST_PERSON_ID and (person_id >> bit) % 2 == 0


def two_way_age_in_search_by_default(person_id: int) -> bool:
    return _treated(person_id, bit=0)


def two_way_age_in_feed(person_id: int) -> bool:
    return _treated(person_id, bit=1)
