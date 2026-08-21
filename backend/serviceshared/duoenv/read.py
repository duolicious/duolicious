import os


def required_str(name: str) -> str:
    value = os.environ.get(name)
    if value is None:
        raise RuntimeError(f'The environment variable {name} must be set')
    return value


def required_int(name: str) -> int:
    return _parse_int(name, required_str(name))


def str_with(name: str, default: str) -> str:
    return os.environ.get(name, default)


def str_or_none(name: str) -> str | None:
    return os.environ.get(name)


def stripped_str(name: str) -> str:
    return os.environ.get(name, '').strip()


def int_with(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return default if raw is None else _parse_int(name, raw)


def float_with(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        raise RuntimeError(
            f'The environment variable {name} has unparseable value {raw!r}'
        )


def flag_with(name: str, default: str) -> bool:
    return os.environ.get(name, default).lower() not in ['false', 'f', '0', 'no']


def csv(name: str) -> list[str]:
    raw = os.environ.get(name, '')
    return [s.strip() for s in raw.split(',') if s.strip()]


def _parse_int(name: str, raw: str) -> int:
    try:
        return int(raw)
    except ValueError:
        raise RuntimeError(
            f'The environment variable {name} has unparseable value {raw!r}'
        )
