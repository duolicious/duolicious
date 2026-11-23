import unittest

from service.api.search.featured import feature
from serviceshared.database import Row

MAN, WOMAN, NON_BINARY = 1, 2, 3


def row(person_id: int) -> Row:
    return dict(
        prospect_person_id=person_id,
        profile_photo_uuid=f'first-{person_id}',
        profile_photo_blurhash=f'first-blurhash-{person_id}',
    )


def person(gender_id: int, position: int | None = None) -> Row:
    return dict(
        gender_id=gender_id,
        position=position,
        photo_uuid=position and f'featured-{position}',
        photo_blurhash=position and f'featured-blurhash-{position}',
    )


class TestFeature(unittest.TestCase):
    def ids(self, rows: list[Row]) -> list[int]:
        return [r['prospect_person_id'] for r in rows]

    def test_featured_people_lead_their_gender_in_list_order(self) -> None:
        people = {
            1: person(MAN),
            2: person(MAN, position=9),
            3: person(MAN, position=4),
            4: person(MAN),
        }

        featured = feature([row(1), row(2), row(3), row(4)], people)

        self.assertEqual(self.ids(featured), [3, 2, 1, 4])

    def test_each_gender_keeps_its_places(self) -> None:
        people = {
            1: person(WOMAN),
            2: person(MAN),
            3: person(NON_BINARY),
            4: person(WOMAN, position=2),
            5: person(MAN, position=1),
        }

        featured = feature([row(1), row(2), row(3), row(4), row(5)], people)

        self.assertEqual(self.ids(featured), [4, 5, 3, 1, 2])

    def test_featured_people_show_their_listed_photo(self) -> None:
        people = {1: person(MAN), 2: person(MAN, position=7)}

        featured = feature([row(1), row(2)], people)

        self.assertEqual(
            featured,
            [
                dict(
                    prospect_person_id=2,
                    profile_photo_uuid='featured-7',
                    profile_photo_blurhash='featured-blurhash-7',
                ),
                row(1),
            ],
        )

    def test_nobody_listed_keeps_the_order(self) -> None:
        people = {1: person(WOMAN), 2: person(MAN), 3: person(MAN)}
        rows = [row(1), row(2), row(3)]

        self.assertEqual(feature(rows, people), rows)


if __name__ == '__main__':
    unittest.main()
