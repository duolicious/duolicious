from service.api.chat.messagestorage.inbox import (
        UpsertConversationJob,
        clear_inbox_reaction,
        process_upsert_conversation_batch,
        set_inbox_reaction,
)
from service.api.chat.messagestorage.mam import (
        process_store_mam_message_batch,
        StoreMamMessageJob)
from service.api.chat.messagestorage.reaction import set_mam_reaction
from service.api.chat.messagestorage.setmessaged import (
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
            question_id=(
                message.question_id
                if isinstance(message, ChatMessage)
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


@dataclass(frozen=True)
class StoredReaction:
    # A nonempty emoji that differs from the previous one; drives the
    # partner's push notification.
    is_new_visible_reaction: bool
    reactor_inbox_updated: bool
    partner_inbox_updated: bool


async def store_reaction(
    reactor_username: str,
    partner_username: str,
    reactor_id: int,
    partner_id: int,
    reactor_copy_id: int,
    emoji: str,
    previous_reaction: str | None,
    target_body: str,
    deliver_to_recipient: bool,
) -> StoredReaction | None:
    """
    Stores a reaction the way `store_message` stores a message: the archive
    write, both inbox rows and the `messaged` upsert commit in one
    transaction, so the archive can never show a reaction the inboxes missed.
    Synchronous (no batcher) because the caller rejects invalid targets and
    publishes the updated inbox entries immediately. Returns None when the
    target isn't a message the reactor received; the `messaged` upsert unhides
    the conversation in the partner's inbox when the reactor never replied.
    """
    is_new_visible_reaction = bool(emoji) and emoji != previous_reaction

    async with api_tx('read committed') as tx:
        stored = await set_mam_reaction(
            tx,
            reactor_username=reactor_username,
            partner_username=partner_username,
            reactor_copy_id=reactor_copy_id,
            emoji=emoji,
            deliver_to_recipient=deliver_to_recipient,
        )

        if not stored:
            return None

        if is_new_visible_reaction:
            await set_inbox_reaction(
                tx,
                reactor_username=reactor_username,
                partner_username=partner_username,
                reaction_target_mam_id=reactor_copy_id,
                emoji=emoji,
                target_body=target_body,
                deliver_to_recipient=deliver_to_recipient,
            )
            await process_set_messaged_batch(tx, [
                SetMessagedJob(
                    from_id=reactor_id,
                    to_id=partner_id,
                )
            ])
            return StoredReaction(
                is_new_visible_reaction=True,
                reactor_inbox_updated=True,
                partner_inbox_updated=deliver_to_recipient,
            )

        if not emoji:
            cleared = await clear_inbox_reaction(
                tx,
                reactor_username=reactor_username,
                partner_username=partner_username,
                reaction_target_mam_id=reactor_copy_id,
                deliver_to_recipient=deliver_to_recipient,
            )
            return StoredReaction(
                is_new_visible_reaction=False,
                reactor_inbox_updated=cleared.reactor_reverted,
                partner_inbox_updated=cleared.partner_reverted,
            )

        return StoredReaction(
            is_new_visible_reaction=False,
            reactor_inbox_updated=False,
            partner_inbox_updated=False,
        )


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
    flush_interval=0.1,
    min_batch_size=1,
    max_batch_size=1000,
    retry=False,
)
