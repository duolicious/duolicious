from collections.abc import Mapping

from serviceshared.database import Row
from service.api.search.featured.photos import FEATURED_PHOTO_UUIDS

Q_FEATURED = """
SELECT
    person.id,
    person.gender_id,
    photo.uuid AS photo_uuid,
    photo.blurhash AS photo_blurhash,
    array_position(%(photo_uuids)s::TEXT[], photo.uuid) AS position
FROM
    person
LEFT JOIN
    photo
ON
    photo.person_id = person.id
AND
    photo.uuid = ANY(%(photo_uuids)s::TEXT[])
WHERE
    person.id = ANY(%(person_ids)s::INT[])
"""


def _show_featured_photo(row: Row, person: Row) -> Row:
    if person['position'] is None:
        return row

    return row | dict(
        profile_photo_uuid=person['photo_uuid'],
        profile_photo_blurhash=person['photo_blurhash'],
    )


def feature(rows: list[Row], people: Mapping[int, Row]) -> list[Row]:
    def person(row: Row) -> Row:
        return people[row['prospect_person_id']]

    def position(row: Row) -> float:
        return person(row)['position'] or float('inf')

    by_gender = {
        gender_id: iter(sorted(
            (row for row in rows if person(row)['gender_id'] == gender_id),
            key=position,
        ))
        for gender_id in {person(row)['gender_id'] for row in rows}
    }

    return [
        _show_featured_photo(featured, person(featured))
        for featured in (
            next(by_gender[person(row)['gender_id']]) for row in rows
        )
    ]


__all__ = [
    'FEATURED_PHOTO_UUIDS',
    'Q_FEATURED',
    'feature',
]
