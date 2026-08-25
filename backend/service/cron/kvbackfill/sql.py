Q_UNCOMPUTED_PEOPLE = """
SELECT id
FROM person
WHERE kv_who_pre IS NULL
ORDER BY id
LIMIT %(batch_size)s
"""

Q_UNCOMPUTED_COUNT = """
SELECT count(*) AS n
FROM person
WHERE kv_who_pre IS NULL
"""
