from serviceshared.antiabuse.sql import BOT_ACCOUNT_SQL

Q_SELECT_UNMODERATED_PERSON_ABOUT = f"""
WITH bot_account AS ({BOT_ACCOUNT_SQL})
SELECT
    bot_account.uuid AS subject_uuid,
    person.uuid AS object_uuid,
    person.about AS about
FROM
    person
JOIN
    unmoderated_person
ON
    person.id = unmoderated_person.person_id
CROSS JOIN
    bot_account
WHERE
    unmoderated_person.trait = 'about'
"""

Q_DELETE_UNMODERATED_PERSON = """
DELETE FROM
    unmoderated_person
USING
    person
WHERE
    person.id = unmoderated_person.person_id
AND
    person.uuid = %(uuid)s
"""
