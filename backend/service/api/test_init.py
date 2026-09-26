import unittest
from service.api.bootstrap import backfill_looking_for_ids, migrate_unnormalized_emails
from serviceshared.database import api_tx
from serviceshared.database.testcase import DbTestCase

Q_DELETE_PERSONS = """
DELETE FROM person
"""

Q_INSERT_PERSONS = """
INSERT INTO person (
    email,
    normalized_email,
    name,
    url_slug,
    date_of_birth,
    coordinates,
    gender_id,
    about,
    location_short_friendly,
    location_long_friendly,
    location_country,
    unit_id
)
VALUES (
    'ex.ample+1@gmail.com',
    '',
    'Alice',
    'alice',
    '2000-01-01',
    ST_MakePoint(0.0, 0.0),
    1,
    '',
    'Sydney',
    'Sydney, New South Wales, Australia',
    'Australia',
    1
), (
    'legacy@googlemail.com',
    'legacy@googlemail.com',
    'Bob',
    'bob',
    '2000-01-01',
    ST_MakePoint(0.0, 0.0),
    1,
    '',
    'Sydney',
    'Sydney, New South Wales, Australia',
    'Australia',
    1
)
"""

Q_DELETE_BANNED_PERSONS = """
DELETE FROM banned_person
"""

Q_INSERT_BANNED_PERSONS = """
INSERT INTO banned_person (
    normalized_email
)
VALUES
    ('ex.ample+1@gmail.com'),
    ('ex.ample+2@gmail.com')
"""

Q_INSERT_LOOKING_FOR_PERSONS = """
INSERT INTO person (
    email,
    normalized_email,
    name,
    url_slug,
    date_of_birth,
    coordinates,
    gender_id,
    about,
    location_short_friendly,
    location_long_friendly,
    location_country,
    unit_id,
    looking_for_id
)
SELECT
    'looking-for-' || i || '@example.com',
    'looking-for-' || i || '@example.com',
    'Looking For ' || i,
    'looking-for-' || i,
    '2000-01-01',
    ST_MakePoint(0.0, 0.0),
    1,
    '',
    'Sydney',
    'Sydney, New South Wales, Australia',
    'Australia',
    1,
    i
FROM
    generate_series(1, 5) AS i
"""

Q_SELECT_LOOKING_FOR = """
SELECT looking_for_id, looking_for_ids FROM person ORDER BY id
"""

Q_SELECT_PERSON_EMAILS = """
SELECT normalized_email FROM person ORDER BY normalized_email
"""

Q_SELECT_BANNED_PERSON_EMAILS = """
SELECT normalized_email FROM banned_person ORDER BY normalized_email
"""

class Test(DbTestCase):
    async def test_migration(self) -> None:
        async with api_tx() as tx:
            await tx.execute(Q_DELETE_PERSONS)
            await tx.execute(Q_INSERT_PERSONS)

            await tx.execute(Q_DELETE_BANNED_PERSONS)
            await tx.execute(Q_INSERT_BANNED_PERSONS)

        await migrate_unnormalized_emails()

        async with api_tx() as tx:
            rows = await (await tx.execute(Q_SELECT_PERSON_EMAILS)).fetchall()
            emails = [row['normalized_email'] for row in rows]
            self.assertEqual(
                emails,
                ['example@gmail.com', 'legacy@gmail.com'])

            rows = await (await tx.execute(Q_SELECT_BANNED_PERSON_EMAILS)).fetchall()
            emails = [row['normalized_email'] for row in rows]
            self.assertEqual(
                emails,
                ['ex.ample+2@gmail.com', 'example@gmail.com'])

    async def test_looking_for_ids(self) -> None:
        async with api_tx() as tx:
            await tx.execute(Q_DELETE_PERSONS)
            await tx.execute(Q_INSERT_LOOKING_FOR_PERSONS)

        await backfill_looking_for_ids()

        async with api_tx() as tx:
            rows = await (await tx.execute(Q_SELECT_LOOKING_FOR)).fetchall()
            self.assertEqual(
                [(row['looking_for_id'], row['looking_for_ids']) for row in rows],
                [(1, [1]), (2, [2]), (3, [3]), (4, [4]), (5, [5])])

            await tx.execute(
                "UPDATE person SET looking_for_id = 3 WHERE name = 'Looking For 1'")
            await tx.execute(
                "UPDATE person SET looking_for_ids = '{2,5}' WHERE name = 'Looking For 2'")
            rows = await (await tx.execute(Q_SELECT_LOOKING_FOR)).fetchall()
            self.assertEqual(
                [(row['looking_for_id'], row['looking_for_ids']) for row in rows[:2]],
                [(3, [3]), (2, [2, 5])])


if __name__ == '__main__':
    unittest.main()
