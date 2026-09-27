def _treated(person_id: int, first_person_id: int, bit: int) -> bool:
    return person_id >= first_person_id and (person_id >> bit) % 2 == 0


def two_way_age_in_search_by_default(person_id: int) -> bool:
    return _treated(person_id, first_person_id=387800, bit=0)


def two_way_age_in_feed(person_id: int) -> bool:
    return _treated(person_id, first_person_id=387800, bit=1)


def same_country_only_in_feed(person_id: int) -> bool:
    return _treated(person_id, first_person_id=387830, bit=2)
