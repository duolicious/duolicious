import difflib
import re
from typing import Tuple
from serviceshared.util.timeout import run_with_timeout


# TODO: This doesn't work for right-to-left languages like Arabic


BOUNDARY_CHARS = '.!?\n'


def get_last_addition(old: str, new: str) -> Tuple[int, int] | None:
    try:
        sm = run_with_timeout(
            0.5,
            difflib.SequenceMatcher,
            None,
            old,
            new
        )
    except TimeoutError:
        return None

    additions = [
        (j1, j2)
        for tag, i1, i2, j1, j2 in sm.get_opcodes()
        if tag in ('insert', 'replace') and j2 > j1
    ]

    return additions[-1] if additions else None


def diff_addition_with_context(
    old: str,
    new: str,
    window_size: int = 300,
    max_newlines: int = 20,
) -> str | None:
    last = get_last_addition(old, new)
    if not last:
        return None

    start_addition, end_addition = last

    addition = new[start_addition:end_addition]

    # Ignore whitespace additions
    if not addition.strip():
        return None

    # Try to pick a sentence/line boundary that both precedes the insertion and
    # still lets us cover it.
    boundary_pattern = re.compile(rf'[{BOUNDARY_CHARS}]')
    boundaries = [0] + [m.end() for m in boundary_pattern.finditer(new)]

    # Target for centering: half a window before the insertion
    target = start_addition - window_size // 2

    # Find all boundaries such that `boundary <= start_addition`
    # (i.e. the boundary starts before the insertion)
    left_boundaries = [
        boundary for boundary in boundaries
        if boundary <= start_addition
    ]

    best_boundary = min(left_boundaries, key=lambda b: abs(b - target))

    snippet = new[best_boundary:best_boundary + window_size]

    # Truncate by `max_newlines`
    lines = snippet.splitlines()
    snippet = '\n'.join(lines[:max_newlines])

    # Strip whitespace
    snippet = snippet.strip()

    if not snippet:
        return None

    # Add ellipsis
    if not new.strip().endswith(snippet):
        snippet = snippet.rstrip(f'{BOUNDARY_CHARS},') + '…'

    return snippet
