from collections.abc import Mapping

from serviceshared.database import Row
from service.api.search.featured.photos import FEATURED_PHOTO_UUIDS

Q_FEATURED = """
SELECT
    person.id,
    gender.name AS gender,
    photo.uuid AS photo_uuid,
    photo.blurhash AS photo_blurhash,
    array_position(%(photo_uuids)s::TEXT[], photo.uuid) AS position
FROM
    person
JOIN
    gender
ON
    gender.id = person.gender_id
LEFT JOIN
    photo
ON
    photo.person_id = person.id
AND
    photo.uuid = ANY(%(photo_uuids)s::TEXT[])
WHERE
    person.id = ANY(%(person_ids)s::INT[])
"""

_INTERLEAVED_GENDERS = ('Man', 'Woman')


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

    places = {
        row['prospect_person_id']: place / 2
        for place, row in enumerate(rows, start=1)
    } | {
        row['prospect_person_id']: place
        for gender in _INTERLEAVED_GENDERS
        for place, row in enumerate(
            sorted(
                (row for row in rows if person(row)['gender'] == gender),
                key=position,
            ),
            start=1,
        )
    }

    return [
        _show_featured_photo(row, person(row))
        for row in sorted(
            rows,
            key=lambda row: places[row['prospect_person_id']],
        )
    ]


__all__ = [
    'FEATURED_PHOTO_UUIDS',
    'Q_FEATURED',
    'feature',
]
