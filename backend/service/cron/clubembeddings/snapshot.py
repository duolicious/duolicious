import psycopg
from serviceshared.duoenv.shared import DB_HOST, DB_PASS, DB_PORT, DB_USER
from serviceshared.pgvector import parse_pgvector, to_pgvector
from service.cron.clubembeddings.ppmi import (
    club_embeddings_from_memberships,
    changed_embeddings,
)


def compute_club_embeddings() -> dict[str, str]:
    with psycopg.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        dbname='duo_api',
    ) as conn:
        memberships = conn.execute(
            'SELECT person_id, club_name FROM person_club'
        ).fetchall()
        previous_rows = conn.execute(
            'SELECT name, embedding::TEXT FROM club '
            'WHERE embedding != array_full(64, 0)::VECTOR(64)'
        ).fetchall()

    previous = {
        str(name): parse_pgvector(str(embedding))
        for name, embedding in previous_rows
    }

    embeddings = club_embeddings_from_memberships(
        memberships=[(int(p), str(c)) for p, c in memberships],
        previous=previous,
    )

    changed = changed_embeddings(embeddings, previous)

    return {name: to_pgvector(vec) for name, vec in changed.items()}
