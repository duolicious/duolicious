"""
Card data for chat messages that reply to a quiz question. This is the choke
point for what each participant may see: the viewer's own answer is returned
unfiltered (it's theirs), the partner's only through the shared
`ANSWER_VISIBLE_TO_OTHERS` predicate -- the same one the MAM fetch path
(`Q_SELECT_MESSAGE`) and the feed apply.

Question text and topic never change, so `fetch_question` caches hits forever;
misses aren't cached, in case the question is created later.
"""
from async_lru_cache import AsyncLruCache
from dataclasses import dataclass
from database import api_tx
from qanda import ANSWER_VISIBLE_TO_OTHERS


Q_FETCH_QUESTION = """
SELECT
    question,
    topic
FROM
    question
WHERE
    id = %(question_id)s
"""


Q_FETCH_CARD_ANSWERS = f"""
SELECT
    viewer_answer.answer AS viewer_answer,
    viewer_answer.public_ AS viewer_answer_public,
    partner_answer.answer AS partner_answer
FROM
    (SELECT 1) AS _
LEFT JOIN LATERAL (
    SELECT
        answer.answer,
        answer.public_
    FROM
        answer
    WHERE
        answer.person_id = %(viewer_id)s
    AND
        answer.question_id = %(question_id)s
) AS viewer_answer
ON
    TRUE
LEFT JOIN LATERAL (
    SELECT
        answer.answer
    FROM
        answer
    WHERE
        answer.person_id = %(partner_id)s
    AND
        answer.question_id = %(question_id)s
    AND
        {ANSWER_VISIBLE_TO_OTHERS}
) AS partner_answer
ON
    TRUE
"""


@dataclass(frozen=True)
class Card:
    question: str
    topic: str
    viewer_answer: bool | None
    viewer_answer_public: bool | None
    partner_answer: bool | None


@AsyncLruCache(cache_condition=bool)
async def fetch_question(question_id: int) -> dict | None:
    async with api_tx('read committed') as tx:
        await tx.execute(Q_FETCH_QUESTION, dict(question_id=question_id))
        return await tx.fetchone()


async def fetch_card(
    question_id: int,
    viewer_id: int,
    partner_id: int,
) -> Card | None:
    question_row = await fetch_question(question_id)

    if question_row is None:
        return None

    async with api_tx('read committed') as tx:
        await tx.execute(Q_FETCH_CARD_ANSWERS, dict(
            question_id=question_id,
            viewer_id=viewer_id,
            partner_id=partner_id,
        ))
        row = await tx.fetchone()

    return Card(
        question=question_row['question'],
        topic=question_row['topic'],
        viewer_answer=row['viewer_answer'] if row else None,
        viewer_answer_public=row['viewer_answer_public'] if row else None,
        partner_answer=row['partner_answer'] if row else None,
    )
