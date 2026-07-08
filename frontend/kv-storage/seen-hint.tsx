import { storeKv } from './kv-storage';
import { getSignedInUser } from '../events/signed-in-user';

// A persisted "has this account seen this one-time hint?" flag, shared by the
// app's one-time hints (e.g. `seenReplyHint`, `seenInboxFilterHint`).
//
// The flag is scoped per signed-in account rather than per device, so that
// different users sharing a device each get to see the hint. We persist the
// UUIDs that have dismissed the hint as a single list under one key (so
// `clearAllKv` and friends keep working).
//
// To stop that list from growing without bound on devices that see many
// accounts, we cap it and evict the oldest entries first (FIFO). The cap keeps
// reads/writes effectively constant-time and the stored value tiny. The
// trade-off is that a long-dormant account can eventually "forget" it saw the
// hint, which is harmless - at worst it sees the hint once more.
const MAX_REMEMBERED = 10;

type Key = Parameters<typeof storeKv>[0];

const parseSeen = (raw: unknown): string[] => {
  if (typeof raw !== 'string') {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
};

const hasSeen = (seen: string[], personUuid: string): boolean =>
  seen.includes(personUuid);

const withSeen = (seen: string[], personUuid: string): string[] =>
  hasSeen(seen, personUuid)
    ? seen
    : [...seen, personUuid].slice(-MAX_REMEMBERED);

const withoutSeen = (seen: string[], personUuid: string): string[] =>
  hasSeen(seen, personUuid)
    ? seen.filter((uuid) => uuid !== personUuid)
    : seen;

const applySeen = (
  seen: string[],
  personUuid: string,
  value?: boolean,
): { result: boolean, next: string[] } => {
  if (value === undefined) {
    return { result: hasSeen(seen, personUuid), next: seen };
  }

  return {
    result: value,
    next: value
      ? withSeen(seen, personUuid)
      : withoutSeen(seen, personUuid),
  };
};

// --- Impure storage access -----------------------------------------------

const makeSeenHint = (key: Key) => {
  const readSeen = async (): Promise<string[]> =>
    parseSeen(await storeKv(key, undefined));

  const writeSeen = async (seen: string[]): Promise<void> => {
    await storeKv(key, JSON.stringify(seen));
  };

  return async (value?: boolean): Promise<boolean> => {
    const personUuid = getSignedInUser()?.personUuid;

    // Without a signed-in account there's nothing to scope the flag to: treat
    // the hint as unseen and skip any writes.
    if (!personUuid) {
      return false;
    }

    const seen = await readSeen();

    const { result, next } = applySeen(seen, personUuid, value);

    if (next !== seen) {
      await writeSeen(next);
    }

    return result;
  };
};

export {
  makeSeenHint,
};
