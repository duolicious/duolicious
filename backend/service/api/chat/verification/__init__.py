from service.api.async_lru_cache import AsyncLruCache
from serviceshared.database import api_tx, row_int

_Q_MISSING_VERIFICATION_LEVEL = """
SELECT
    required_verification_level_id
FROM
    person
WHERE
    id = %(person_id)s
AND
    verification_level_id < required_verification_level_id
"""


@AsyncLruCache(ttl=3)  # 3 seconds
async def missing_verification_level(person_id: int) -> int | None:
    async with api_tx('read committed') as tx:
        await tx.execute(_Q_MISSING_VERIFICATION_LEVEL, dict(person_id=person_id))
        row = await tx.fetchone()
        return None if row is None else row_int(row, 'required_verification_level_id')
