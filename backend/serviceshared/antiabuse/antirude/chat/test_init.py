import json
import unittest
from pathlib import Path

from serviceshared.antiabuse.antirude.chat import is_rude


def precision_and_recall(name: str) -> tuple[float, float]:
    with open(Path(__file__).parent / name) as f:
        corpus = [json.loads(line) for line in f]

    predictions = [(is_rude(e['text']), e['rude']) for e in corpus]

    true_positives = sum(p and r for p, r in predictions)
    precision = true_positives / sum(p for p, _ in predictions)
    recall = true_positives / sum(r for _, r in predictions)

    return round(precision, 3), round(recall, 3)


class TestIsRude(unittest.TestCase):
    def test_precision_and_recall(self) -> None:
        self.assertEqual(
            {
                name: precision_and_recall(name)
                for name in ['random_intros.jsonl', 'corpus.jsonl']
            },
            {
                'random_intros.jsonl': (0.929, 0.718),
                'corpus.jsonl': (0.967, 0.845),
            })


if __name__ == '__main__':
    unittest.main()
