import json
from dataclasses import dataclass
from pathlib import Path

TARGETS = {'yes': 1.0, 'maybe': 0.6, 'no': 0.0}


@dataclass
class Item:
    split: str
    is_benchmark: bool
    label: str
    claimed_age: int
    about: str
    before: list[tuple[bool, str]]
    message: str


def load(data: Path) -> list[Item]:
    labels = {
        row['id']: row['label']
        for path in sorted(data.glob('labels/*.jsonl'))
        for row in map(json.loads, filter(str.strip, path.read_text().splitlines()))}
    items: dict[str, Item] = {}
    for path in sorted(data.glob('items/*.jsonl')):
        for row in map(json.loads, path.read_text().splitlines()):
            items.setdefault(row['id'], Item(
                split=row['split'],
                is_benchmark=row['source'].startswith(('stage1_random', 'unbiased')),
                label=labels.get(row['id'], 'skip'),
                claimed_age=row['claimed_age'],
                about=row['about'],
                before=[(who == 'ME', text) for who, text in row['before']],
                message=row['target']))

    return [item for item in items.values() if item.label != 'skip']
