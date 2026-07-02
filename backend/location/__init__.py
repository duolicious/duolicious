from database import api_tx
from async_lru_cache import AsyncLruCache
import json
import os
from typing import Optional

_locations_json_file = os.path.join(
        os.path.dirname(__file__), '..',
        'locations', 'locations.json')

Q_SEARCH_LOCATIONS = """
SELECT
    long_friendly
FROM
    location
WHERE
    long_friendly ILIKE %(first_character)s || '%%'
ORDER BY
    long_friendly <-> %(search_string)s
LIMIT 10
"""

async def init_db() -> None:
    with open(_locations_json_file) as f:
        locations = json.load(f)

    async with api_tx() as tx:
        if (await tx.require_one("SELECT COUNT(*) FROM location"))['count'] != 0:
            return

        await tx.executemany(
            """
            INSERT INTO Location (
                short_friendly,
                long_friendly,
                city,
                subdivision,
                country,
                coordinates,
                verification_required
            ) VALUES (
                %(short_friendly)s,
                %(long_friendly)s,
                %(city)s,
                %(subdivision)s,
                %(country)s,
                ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326),
                %(verification_required)s
            ) ON CONFLICT DO NOTHING
            """,
            locations
        )

@AsyncLruCache(maxsize=26**3)
async def get_search_locations(q: Optional[str]) -> object:
    if q is None:
        return []

    normalized_whitespace = ' '.join(q.split())

    if len(normalized_whitespace) < 1:
        return []

    params = dict(
        first_character=normalized_whitespace[0],
        search_string=normalized_whitespace,
    )

    async with api_tx('READ COMMITTED') as tx:
        row_tx = await tx.execute(Q_SEARCH_LOCATIONS, params)
        rows = await row_tx.fetchall()
        return [row['long_friendly'] for row in rows]
