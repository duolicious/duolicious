import { listen, lastEvent, notify } from '../../../events/events';
import { useRetained } from '../../../events/use-retained';
import { EV_CHAT_WS_RECEIVE } from '../../websocket-layer';
import { useSignedInUser } from '../../../events/signed-in-user';

const ownLastMessageEventKey = (personUuid: string) =>
  `conversation-own-last-message-at-${personUuid}`;

const readAtEventKey = (personUuid: string) =>
  `read-receipt-at-${personUuid}`;

const advanceReadAt = (personUuid: string, readTime: Date) => {
  const key = readAtEventKey(personUuid);
  const prev = lastEvent<Date | null>(key) ?? null;
  const next = !prev || readTime > prev ? readTime : prev;
  if (next !== prev) {
    notify<Date | null>(key, next);
  }
};

/**
 * Publishes the timestamp of the conversation's last message, but only when the
 * current user is the one who sent it (null otherwise — including when the other
 * person's message is last). The chat controller drives this as messages are
 * sent, received and fetched from the archive; the read-receipt model consumes
 * it to decide whether to show a receipt (or upsell) for that message.
 */
const notifyOwnLastMessageAt = (
  personUuid: string,
  timestamp: Date | null,
) => {
  notify<Date | null>(ownLastMessageEventKey(personUuid), timestamp);
};

// A live message from the other person becomes the conversation's last message,
// so our own message is no longer last and there's nothing to show a receipt
// for: clear it. Our own outgoing messages aren't echoed back on this stream
// (the controller reports them from `sendMessage` instead), and the archived
// history is reconciled whenever the conversation is fetched.
const clearOwnLastMessageOnIncoming = (doc: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const message = doc?.message;

  if (!message || message['@type'] !== 'chat') {
    return;
  }

  const personUuid = String(message['@from'] ?? '').split('@')[0];

  if (!personUuid) {
    return;
  }

  if (lastEvent<Date | null>(ownLastMessageEventKey(personUuid)) != null) {
    notifyOwnLastMessageAt(personUuid, null);
  }
};

listen(EV_CHAT_WS_RECEIVE, clearOwnLastMessageOnIncoming);

// A module-level listener (not a hook) so it's alive before the read-receipt UI
// mounts: the read time arrives while the conversation is still loading from the
// archive, and retaining it means the element picks it up whenever it mounts.
const resolveReadReceipt = (doc: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const message = doc?.message;

  if (!message || message['@type'] !== 'read-receipt') {
    return;
  }

  const personUuid = String(message['@from'] ?? '').split('@')[0];

  if (!personUuid) {
    return;
  }

  const stamp = message.displayed?.['@stamp'];

  if (!stamp) {
    return;
  }

  advanceReadAt(personUuid, new Date(stamp));
};

listen(EV_CHAT_WS_RECEIVE, resolveReadReceipt);

/**
 * The time the other person last read our message, but only while our message
 * is the conversation's last one. Null when there's nothing to show: they
 * haven't read it, our message isn't the last one, or we haven't sent one.
 */
const useReadReceipt = (personUuid: string): Date | null => {
  const readAt = useRetained<Date>(readAtEventKey(personUuid));
  const ownLastMessageAt = useRetained<Date>(ownLastMessageEventKey(personUuid));

  return readAt && ownLastMessageAt && readAt >= ownLastMessageAt
    ? readAt
    : null;
};

/**
 * Whether to offer the read-receipt upsell instead of a receipt: the user can't
 * see read receipts (they're not a gold user) but our message is the last one
 * in the conversation, so there might be a receipt for it. The server never
 * sends receipts to non-gold users, so `useReadReceipt` is always null for them
 * — the two are mutually exclusive.
 */
const useReadReceiptUpsell = (personUuid: string): boolean => {
  const [signedInUser] = useSignedInUser();
  const ownLastMessageAt = useRetained<Date>(ownLastMessageEventKey(personUuid));

  return !signedInUser?.hasGold && !!ownLastMessageAt;
};

export {
  notifyOwnLastMessageAt,
  useReadReceipt,
  useReadReceiptUpsell,
};
