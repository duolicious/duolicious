import logging

# This module doubles as the deploy-time entrypoint (see the bottom of the
# file), so it configures logging the same way the services do.
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s:     %(asctime)s %(name)s: %(message)s',
)

logger = logging.getLogger(__name__)


def create_dbs() -> None:
    # All this stuff just to run `CREATE DATABASE IF NOT EXISTS DB_NAME`
    import psycopg
    import time

    from serviceshared.duoenv.shared import DB_HOST, DB_PASS, DB_PORT, DB_USER

    _conninfo = psycopg.conninfo.make_conninfo(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
    )

    def create_db(name: str) -> None:
        for _ in range(10):
            try:
                with psycopg.connect(_conninfo, autocommit=True) as conn:
                    with conn.cursor() as cur:
                        cur.execute(f"CREATE DATABASE {name}")
                logger.info(f'Created database: {name}')
                break
            except (
                psycopg.errors.DuplicateDatabase,
                psycopg.errors.UniqueViolation,
            ):
                logger.info(f'Database already exists: {name}')
                break
            except psycopg.errors.OperationalError as e:
                logger.warning(
                    f'Creating database(s) failed; waiting and trying again: {e}'
                )
                time.sleep(1)

    create_db('duo_api')

async def init_db() -> None:
    # Now DB_NAME exists, we do do the rest of the init.
    from serviceshared.database import open_db_pool
    from service.api import bootstrap
    from service.api import location
    from service.api.qanda import question

    init_funcs = [
        bootstrap.init_db,
        location.init_db,
        question.init_db,
    ]

    await open_db_pool()

    logger.info('Initializing api DB...')
    for i, init_func in enumerate(init_funcs, start=1):
        logger.info(f'  * {i} of {len(init_funcs)}')
        await init_func()
    logger.info('Finished initializing api DB')

create_dbs()
import asyncio
asyncio.run(init_db())
