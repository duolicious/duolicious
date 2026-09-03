from dataclasses import dataclass
import math

_AGE_FLOOR = 18
_AGE_CEILING = 99

_DEFAULT_MIN_AGE = (0.8, 1.6)
_DEFAULT_MAX_AGE = (1.2, -1.6)

_MIN_AGE_BY_GENDER = {
    'Man': (0.75, 1.25),
}

_MAX_AGE_BY_GENDER = {
    'Man': (1.25, -1.25),
    'Woman': (2.2, -19.0),
}


@dataclass(frozen=True)
class AgeBounds:
    min_age: int | None
    max_age: int | None


def _evaluate(coefficients: tuple[float, float], age: int) -> int:
    slope, intercept = coefficients
    return math.floor(slope * age + intercept + 0.5)


def best_age(age: int, gender: str) -> AgeBounds:
    min_age = _evaluate(_MIN_AGE_BY_GENDER.get(gender, _DEFAULT_MIN_AGE), age)
    max_age = _evaluate(_MAX_AGE_BY_GENDER.get(gender, _DEFAULT_MAX_AGE), age)

    return AgeBounds(
        min_age=None if min_age <= _AGE_FLOOR else min_age,
        max_age=None if max_age >= _AGE_CEILING else max_age,
    )
