"""
Publishes quiz-answer changes to the `answers-{username}` Redis channel, which
chat connections join alongside the person's online-status channel. Callers
must only publish publicly visible state (see `AnswerWriteResult` in `qanda`);
nothing on this channel is access-controlled beyond the subscription checks in
`service.api.chat.online`.
"""
import traceback
from chatprotocol.outbound import AnswerUpdate, answer_to_wire, to_bus
from redisclient import make_redis_client

_redis = make_redis_client()


def answers_channel(username: str) -> str:
    return f'answers-{username}'


async def publish_answer_update(
    username: str,
    question_id: int,
    answer: bool | None,
) -> None:
    try:
        await _redis.publish(
            answers_channel(username),
            to_bus(AnswerUpdate(
                username=username,
                question_id=question_id,
                answer=answer_to_wire(answer),
            )),
        )
    except Exception:
        print(traceback.format_exc())
