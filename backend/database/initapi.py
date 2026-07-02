def create_dbs() -> None:
    # All this stuff just to run `CREATE DATABASE IF NOT EXISTS DB_NAME`
    import os
    import psycopg
    import time

    DB_HOST = os.environ['DUO_DB_HOST']
    DB_PORT = os.environ['DUO_DB_PORT']
    DB_USER = os.environ['DUO_DB_USER']
    DB_PASS = os.environ['DUO_DB_PASS']

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
                print(f'Created database: {name}')
                break
            except (
                psycopg.errors.DuplicateDatabase,
                psycopg.errors.UniqueViolation,
            ):
                print(f'Database already exists: {name}')
                break
            except psycopg.errors.OperationalError as e:
                print(
                    'Creating database(s) failed; waiting and trying again:',
                    e
                )
                time.sleep(1)

    create_db('duo_api')

async def init_db() -> None:
    # Now DB_NAME exists, we do do the rest of the init.
    from service import api
    import location
    import person
    from qanda import question

    init_funcs = [
        api.init_db,
        location.init_db,
        person.init_db,
        question.init_db,
    ]

    print('Initializing api DB...')
    for i, init_func in enumerate(init_funcs, start=1):
        print(f'  * {i} of {len(init_funcs)}')
        await init_func()
    print('Finished initializing api DB')

create_dbs()
import asyncio
asyncio.run(init_db())
