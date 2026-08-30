from typing import List, Literal
from collections import defaultdict
from dataclasses import asdict, dataclass
from serviceshared.database import Tx

Q_SET_MESSAGED = """
INSERT INTO messaged (
    subject_person_id,
    object_person_id
)
SELECT from_id, to_id
FROM unnest(%(from_ids)s::INT[], %(to_ids)s::INT[]) AS t(from_id, to_id)
ON CONFLICT DO NOTHING
RETURNING subject_person_id, object_person_id
"""

Q_ADD_PERSON_COUNTS = """
UPDATE person SET
    count_intros_received =
        count_intros_received + %(received)s,
    count_intros_received_with_reply =
        count_intros_received_with_reply + %(received_with_reply)s,
    count_intros_sent =
        count_intros_sent + %(sent)s,
    count_intros_sent_with_reply =
        count_intros_sent_with_reply + %(sent_with_reply)s,
    count_messages_received =
        count_messages_received + %(messages_received)s
WHERE id = %(person_id)s
"""


@dataclass(frozen=True)
class SetMessagedJob:
    from_id: int
    to_id: int
    is_intro: bool
    reaction_or_chat: Literal['reaction', 'chat']


@dataclass
class PersonCounts:
    received: int = 0
    received_with_reply: int = 0
    sent: int = 0
    sent_with_reply: int = 0
    messages_received: int = 0


async def process_set_messaged_batch(
    tx: Tx,
    batch: List[SetMessagedJob],
) -> None:
    distinct_messaged = {(m.from_id, m.to_id): m for m in sorted(
            batch, key=lambda m: (m.from_id, m.to_id))}

    await tx.execute(Q_SET_MESSAGED, dict(
        from_ids=[from_id for from_id, _ in distinct_messaged],
        to_ids=[to_id for _, to_id in distinct_messaged],
    ))

    new_rows = await tx.fetchall()

    counts: defaultdict[int, PersonCounts] = defaultdict(PersonCounts)

    for row in new_rows:
        job = distinct_messaged[
                (row['subject_person_id'], row['object_person_id'])]

        if job.is_intro:
            counts[job.from_id].sent += 1
            counts[job.to_id].received += 1
        else:
            counts[job.from_id].received_with_reply += 1
            counts[job.to_id].sent_with_reply += 1

    for job in batch:
        if job.reaction_or_chat == 'chat':
            counts[job.to_id].messages_received += 1

    await tx.executemany(Q_ADD_PERSON_COUNTS, [
        dict(person_id=person_id, **asdict(person_counts))
        for person_id, person_counts in sorted(counts.items())])
