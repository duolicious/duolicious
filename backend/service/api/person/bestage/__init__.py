from dataclasses import dataclass

_AGE_FLOOR = 18
_AGE_CEILING = 99


@dataclass(frozen=True)
class AgeBounds:
    min_age: int | None
    max_age: int | None


def best_age(age: int) -> AgeBounds:
    min_age = round(0.8 * age + 1.6)
    max_age = round(1.2 * age - 1.6)
    return AgeBounds(
        min_age=None if min_age <= _AGE_FLOOR else min_age,
        max_age=None if max_age >= _AGE_CEILING else max_age,
    )
