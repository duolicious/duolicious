import logging
from typing import Literal

from serviceshared.antiabuse.networkactivity import count_sql
from serviceshared.database import api_tx

logger = logging.getLogger(__name__)


async def count_network_activity(
    column: Literal['sign_ups', 'shadow_bans'],
    person_ids: list[int],
) -> None:
    try:
        async with api_tx('READ COMMITTED') as tx:
            await tx.execute(count_sql(column), dict(person_ids=person_ids))
    except Exception:
        logger.exception('Could not count network activity')
