import {
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  listen,
  notify,
} from '../../../events/events';
import {
  send,
  EV_CHAT_WS_RECEIVE,
} from '../../websocket-layer';
import { ONLINE_RECENTLY_WINDOW_MS } from '../../../constants/constants';
import { assert } from '../../../util/util';

// Global reference counts (online status) per person
const REFERENCE_COUNT_BY_PERSON_UUID: Record<string, number> = {};

// Batching mechanism state
const BATCH_WINDOW_MS = 200;
const pendingDeltas: Record<string, number> = {};
let batchTimeout: ReturnType<typeof setTimeout> | null = null;

const eventKey = (personUuid: string) => {
  return `is-online-${personUuid}`;
};

const onlineStatuses = [
  'online',
  'online-recently',
  'offline',
] as const;

type OnlineStatus = typeof onlineStatuses[number];

const isOnlineStatus = (status: unknown): status is OnlineStatus =>
  onlineStatuses.some((s) => s === status);

// Only a past sighting has a time attached, and only some servers report it,
// so 'online-recently' is the one status that carries `lastOnlineAt`.
type OnlinePresence =
  | { status: 'online' }
  | { status: 'online-recently', lastOnlineAt: number | null }
  | { status: 'offline' };

const OFFLINE: OnlinePresence = { status: 'offline' };

const lastOnlineAtOf = (presence: OnlinePresence): number | null =>
  presence.status === 'online-recently' ? presence.lastOnlineAt : null;

const samePresence = (a: OnlinePresence, b: OnlinePresence) =>
  a.status === b.status && lastOnlineAtOf(a) === lastOnlineAtOf(b);

const presenceAt = (presence: OnlinePresence, now: number): OnlinePresence => {
  const at = lastOnlineAtOf(presence);

  return at !== null && now >= at + ONLINE_RECENTLY_WINDOW_MS ?
    OFFLINE :
    presence;
};

// Flush pending changes after the batch window expires.
const flushBatch = () => {
  Object.entries(pendingDeltas).forEach(([personUuid, delta]) => {
    const currentCount = REFERENCE_COUNT_BY_PERSON_UUID[personUuid] ?? 0;
    const newCount = currentCount + delta;

    // If we cross the "offline to online" boundary, send subscribe event.
    if (currentCount === 0 && newCount > 0) {
      const data = { duo_subscribe_online: { '@uuid': personUuid } };
      send({ data });
    }
    // If we cross the "online to offline" boundary, send unsubscribe event.
    else if (currentCount > 0 && newCount === 0) {
      const data = { duo_unsubscribe_online: { '@uuid': personUuid } };
      send({ data });
    }

    // Update the global reference count.
    REFERENCE_COUNT_BY_PERSON_UUID[personUuid] = newCount;
  });

  // Clear pending deltas.
  Object.keys(pendingDeltas).forEach(key => delete pendingDeltas[key]);
  batchTimeout = null;
}

// Ensure we have a scheduled flush.
const scheduleBatch = () => {
  if (!batchTimeout) {
    batchTimeout = setTimeout(flushBatch, BATCH_WINDOW_MS);
  }
}

// The subscribe function now only updates the batch.
const subscribe = (personUuid: string) => {
  pendingDeltas[personUuid] = (pendingDeltas[personUuid] ?? 0) + 1;
  scheduleBatch();

  // Return an unsubscribe function that also batches the change.
  return () => {
    pendingDeltas[personUuid] = (pendingDeltas[personUuid] ?? 0) - 1;
    scheduleBatch();
  };
};

const useOnline = (personUuid: string | null | undefined): OnlinePresence => {
  const [presence, setPresence] = useState<OnlinePresence>(OFFLINE);
  const presenceRef = useRef<OnlinePresence>(OFFLINE);
  const subscribableRef = useRef(false);
  const personSubRef = useRef<{
    removeSubscription: () => void;
    removeListener: () => void;
  } | null>(null);

  useEffect(() => {
    let expiry: ReturnType<typeof setTimeout> | null = null;

    const cancelExpiry = () => {
      if (expiry === null) {
        return;
      }

      clearTimeout(expiry);
      expiry = null;
    };

    const receivePresence = (data: OnlinePresence | undefined) => {
      cancelExpiry();

      const next = presenceAt(data ?? OFFLINE, Date.now());
      const lastOnlineAt = lastOnlineAtOf(next);

      if (lastOnlineAt !== null) {
        expiry = setTimeout(
          () => receivePresence(OFFLINE),
          lastOnlineAt + ONLINE_RECENTLY_WINDOW_MS - Date.now(),
        );
      }

      if (samePresence(presenceRef.current, next)) {
        return;
      }

      presenceRef.current = next;
      setPresence(next);
    };

    const subscribePerson = () => {
      if (!personUuid || !subscribableRef.current || personSubRef.current) {
        return;
      }

      personSubRef.current = {
        removeSubscription: subscribe(personUuid),
        removeListener: listen<OnlinePresence>(
          eventKey(personUuid),
          receivePresence,
          true,
        ),
      };
    };

    const unsubscribePerson = () => {
      if (!personSubRef.current) {
        return;
      }

      personSubRef.current.removeSubscription();
      personSubRef.current.removeListener();
      personSubRef.current = null;
    };

    const removeSubscribableListener = listen(
      'online-subscribable',
      (data: boolean) => {
        const newStatus = data ?? false;
        subscribableRef.current = newStatus;
        if (newStatus) {
          subscribePerson();
        } else {
          unsubscribePerson();
        }
      },
      true,
    );

    return () => {
      cancelExpiry();
      removeSubscribableListener();
      unsubscribePerson();
    };
  }, [personUuid]);

  return presence;
};

const parseSecondsAgo = (secondsAgo: unknown): number | null => {
  if (secondsAgo === undefined || secondsAgo === null) {
    return null;
  }

  const parsed = Number(secondsAgo);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const presenceOf = (
  status: OnlineStatus,
  secondsAgo: number | null,
): OnlinePresence => {
  if (status === 'online-recently') {
    return {
      status,
      lastOnlineAt:
        secondsAgo === null ? null : Date.now() - secondsAgo * 1000,
    };
  }

  return status === 'online' ? { status } : OFFLINE;
};

const onReceive = async (doc: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const {
      duo_online_event: {
        '@uuid': personUuid,
        '@status': onlineStatus,
        '@seconds_ago': secondsAgo,
      }
    } = doc;

    assert(personUuid);

    assert(onlineStatus);

    notify<OnlinePresence>(
      eventKey(personUuid),
      presenceOf(
        isOnlineStatus(onlineStatus) ? onlineStatus : 'offline',
        parseSecondsAgo(secondsAgo),
      ),
    );
  } catch { }
};

listen(EV_CHAT_WS_RECEIVE, onReceive);

export {
  subscribe,
  useOnline,
};
