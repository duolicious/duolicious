from dataclasses import dataclass

_AGE_FLOOR = 18
_AGE_CEILING = 99


@dataclass(frozen=True)
class AgeBounds:
    min_age: int | None
    max_age: int | None


def _line(slope: float, intercept: float, age: int) -> int:
    return round(slope * age + intercept)


def _control_min_age(age: int) -> int:
    return _line(0.8, 1.6, age)


def _control_max_age(age: int) -> int:
    return _line(1.2, -1.6, age)


def _trial_man_min_age(age: int) -> int:
    return _line(0.75, 1.25, age)


def _trial_man_max_age(age: int) -> int:
    return _line(1.25, -1.25, age)


def _trial_woman_max_age(age: int) -> int:
    return _line(2.2, -19.0, age)


def _clamp_min_age(min_age: int) -> int | None:
    return None if min_age <= _AGE_FLOOR else min_age


def _clamp_max_age(max_age: int) -> int | None:
    return None if max_age >= _AGE_CEILING else max_age


def best_age(age: int, gender: str, trial: bool) -> AgeBounds:
    if not trial:
        return AgeBounds(
            min_age=_clamp_min_age(_control_min_age(age)),
            max_age=_clamp_max_age(_control_max_age(age)),
        )

    if gender == 'Man':
        min_age = _trial_man_min_age(age)
        max_age = _trial_man_max_age(age)
    elif gender == 'Woman':
        # Unchanged by the trial: women get the same lower bound as everyone
        # not in the "Man" or "Woman" branches below.
        min_age = _control_min_age(age)
        max_age = _trial_woman_max_age(age)
    else:
        # Every gender besides "Man" and "Woman" is unaffected by the trial.
        min_age = _control_min_age(age)
        max_age = _control_max_age(age)

    return AgeBounds(
        min_age=_clamp_min_age(min_age),
        max_age=_clamp_max_age(max_age),
    )
