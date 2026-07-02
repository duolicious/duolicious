from service.chat.messagestorage.inbox import (
        UpsertConversationJob,
        process_upsert_conversation_batch,
)
from service.chat.messagestorage.mam import (
        process_store_mam_message_batch,
        StoreMamMessageJob)
from service.chat.messagestorage.setmessaged import (
        process_set_messaged_batch,
        SetMessagedJob)
from batcher import Batcher
from database import api_tx
from chatprotocol.timestamp import now_microseconds
from chatprotocol.message import AudioMessage, ChatMessage
from typing import Awaitable, Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class StoreMessageJob:
    store_mam_message_job: StoreMamMessageJob
    upsert_conversation_job: UpsertConversationJob
    messaged_job: SetMessagedJob


def store_message(
    from_username: str,
    to_username: str,
    from_id: int,
    to_id: int,
    msg_id: str,
    message: ChatMessage | AudioMessage,
    callback: Callable[[], None] | Callable[[], Awaitable[None]] | None = None,
    timestamp_microseconds: int | None = None,
    deliver_to_recipient: bool = True,
) -> None:
    if timestamp_microseconds is None:
        timestamp_microseconds = now_microseconds()

    job = StoreMessageJob(
        store_mam_message_job=StoreMamMessageJob(
            timestamp_microseconds=timestamp_microseconds,
            from_username=from_username,
            to_username=to_username,
            id=msg_id,
            message_body=message.body,
            audio_uuid=(
                message.audio_uuid
                if isinstance(message, AudioMessage)
                else None
            ),
            deliver_to_recipient=deliver_to_recipient,
        ),
        upsert_conversation_job=UpsertConversationJob(
            from_username=from_username,
            to_username=to_username,
            msg_id=msg_id,
            body=message.body,
            deliver_to_recipient=deliver_to_recipient,
        ),
        messaged_job=SetMessagedJob(
            from_id=from_id,
            to_id=to_id,
        ),
    )

    _store_message_batcher.enqueue(job, callback)


async def _process_store_message_batch(batch: list[StoreMessageJob]) -> None:
    store_mam_message_jobs = [
            job.store_mam_message_job
            for job in batch]

    upsert_conversation_jobs = [
            job.upsert_conversation_job
            for job in batch]

    messaged_jobs = [
            job.messaged_job
            for job in batch]

    async with api_tx('read committed') as tx:
        await process_store_mam_message_batch(tx, store_mam_message_jobs)
        await process_upsert_conversation_batch(tx, upsert_conversation_jobs)
        await process_set_messaged_batch(tx, messaged_jobs)


_store_message_batcher = Batcher[StoreMessageJob](
    process_fn=_process_store_message_batch,
    flush_interval=0.5,
    min_batch_size=1,
    max_batch_size=1000,
    retry=False,
)
