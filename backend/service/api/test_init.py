import unittest
from service.api import migrate_unnormalized_emails
from database import api_tx

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

Q_SELECT_PERSON_EMAILS = """
SELECT normalized_email FROM person ORDER BY normalized_email
"""

Q_SELECT_BANNED_PERSON_EMAILS = """
SELECT normalized_email FROM banned_person ORDER BY normalized_email
"""

class Test(unittest.IsolatedAsyncioTestCase):
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
                ['example@gmail.com'])

            rows = await (await tx.execute(Q_SELECT_BANNED_PERSON_EMAILS)).fetchall()
            emails = [row['normalized_email'] for row in rows]
            self.assertEqual(
                emails,
                ['ex.ample+2@gmail.com', 'example@gmail.com'])


if __name__ == '__main__':
    unittest.main()
