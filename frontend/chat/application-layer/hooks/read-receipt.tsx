import {
  listen,
  lastEvent,
  notify,
  useDerivedEvent,
} from '../../../events/events';
import { EV_CHAT_WS_RECEIVE } from '../../websocket-layer';

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

// The time the other person read the message delivered at `deliveredAt`, or
// null when the receipt predates it and so belongs to an earlier message.
const useReadReceipt = (
  personUuid: string,
  deliveredAt: Date | null,
): Date | null =>
  useDerivedEvent<Date, Date | null>(
    readAtEventKey(personUuid),
    (readAt) => readAt && deliveredAt && readAt >= deliveredAt ? readAt : null,
    [deliveredAt?.getTime()],
  );

export {
  useReadReceipt,
};
