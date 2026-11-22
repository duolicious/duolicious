import math
import unittest
from datetime import date, datetime

from serviceshared.introscore import CLIP_WIDTH, Person, inputs, score

SENT_AT = datetime(2026, 1, 1)

NEWCOMER = Person(
    id=1,
    date_of_birth=date(2000, 1, 1),
    gender_id=1,
    orientation_id=1,
    sent=0,
    sent_with_reply=0,
    received=0,
    received_with_reply=0,
    count=0,
    verified_count=0,
    nsfw_score=math.nan,
    clip_embedding=[math.nan] * CLIP_WIDTH,
)

REGULAR = Person(
    id=2,
    date_of_birth=date(1996, 1, 1),
    gender_id=2,
    orientation_id=3,
    sent=10,
    sent_with_reply=4,
    received=40,
    received_with_reply=30,
    count=3,
    verified_count=1,
    nsfw_score=0.25,
    clip_embedding=[CLIP_WIDTH ** -0.5] * CLIP_WIDTH,
)


class TestIntroScore(unittest.TestCase):
    def test_inputs(self) -> None:
        built = inputs(REGULAR, NEWCOMER, SENT_AT)

        self.assertEqual(built['categories'].tolist(), [2, 3, 1, 1])
        self.assertEqual(built['photos'].shape, (2, CLIP_WIDTH))

        regular, newcomer = built['numbers'].reshape(2, -1).tolist()

        self.assertEqual(
            [round(x, 2) for x in regular],
            [30.0, 10.0, 40.0, 0.4, 0.75, 3.0, 1.0, 0.25])
        self.assertEqual([round(x, 2) for x in newcomer[:3]], [26.0, 0.0, 0.0])
        self.assertTrue(all(math.isnan(x) for x in newcomer[3:5]))

    def test_score_is_a_probability(self) -> None:
        for sender, recipient in [(REGULAR, NEWCOMER), (NEWCOMER, REGULAR)]:
            self.assertTrue(0 < score('hey, how are you?', sender, recipient, SENT_AT) < 1)

    def test_score_depends_on_the_intro(self) -> None:
        self.assertNotEqual(
            score('hey, how are you?', REGULAR, NEWCOMER, SENT_AT),
            score('', REGULAR, NEWCOMER, SENT_AT))


if __name__ == '__main__':
    unittest.main()
