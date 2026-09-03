from dataclasses import dataclass

_AGE_FLOOR = 18
_AGE_CEILING = 99

_Coefficients = tuple[float, float]

_CONTROL_MIN_AGE: _Coefficients = (0.8, 1.6)
_CONTROL_MAX_AGE: _Coefficients = (1.2, -1.6)

_NO_OVERRIDES: dict[str, _Coefficients] = {}

_TRIAL_MIN_AGE_BY_GENDER: dict[str, _Coefficients] = {
    'Man': (0.75, 1.25),
}

_TRIAL_MAX_AGE_BY_GENDER: dict[str, _Coefficients] = {
    'Man': (1.25, -1.25),
    'Woman': (2.2, -19.0),
}


@dataclass(frozen=True)
class AgeBounds:
    min_age: int | None
    max_age: int | None


def _evaluate(coefficients: _Coefficients, age: int) -> int:
    slope, intercept = coefficients
    return round(slope * age + intercept)


def best_age(age: int, gender: str, trial: bool) -> AgeBounds:
    min_by_gender = _TRIAL_MIN_AGE_BY_GENDER if trial else _NO_OVERRIDES
    max_by_gender = _TRIAL_MAX_AGE_BY_GENDER if trial else _NO_OVERRIDES

    min_age = _evaluate(min_by_gender.get(gender, _CONTROL_MIN_AGE), age)
    max_age = _evaluate(max_by_gender.get(gender, _CONTROL_MAX_AGE), age)

    return AgeBounds(
        min_age=None if min_age <= _AGE_FLOOR else min_age,
        max_age=None if max_age >= _AGE_CEILING else max_age,
    )
