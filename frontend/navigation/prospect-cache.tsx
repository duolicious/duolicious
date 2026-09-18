// Optimistic rendering cache for prospect-related navigation.
//
// When navigating from a list (inbox, search, feed, visitors) to a prospect's
// profile or conversation screen, we often already have partial data like the
// user's name, primary photo UUID and blurhash. Passing those through React
// Navigation's `route.params` leaks them into the URL, so instead callers can
// stash them here and the target screen reads them as a hint while fetching
// the authoritative copy via the API.

type ProspectHint = {
  name?: string;
  photoUuid?: string | null;
  photoBlurhash?: string | null;
  isAvailableUser?: boolean;
  personUuid?: string;
  urlSlug?: string | null;
  // Numeric id used by some legacy endpoints (compare-answers,
  // compare-personalities). Cached so screens that need it don't have to
  // round-trip through `/prospect-profile/:uuid` again.
  personId?: number;
  // Set by callers that navigate into the profile from a context where the
  // bottom action buttons (send intro etc.) would be redundant - notably the
  // conversation screen, where the user is already messaging that person.
  hideBottomButtons?: boolean;
};

// Cap so a long-running session doesn't slowly accumulate every prospect
// the user has ever interacted with. `Map` preserves insertion order, so we
// can use it as a cheap LRU: bumping a key on touch keeps the most recently
// used entries near the tail and the oldest near the head for eviction.
const MAX_CACHE_ENTRIES = 256;

const hintsByPersonUuid: Map<string, ProspectHint> = new Map();

const touch = (personUuid: string, hint: ProspectHint) => {
  hintsByPersonUuid.delete(personUuid);
  hintsByPersonUuid.set(personUuid, hint);

  while (hintsByPersonUuid.size > MAX_CACHE_ENTRIES) {
    const oldest = hintsByPersonUuid.keys().next().value;
    if (oldest === undefined) break;
    hintsByPersonUuid.delete(oldest);
  }
};

export const setProspectHint = (
  personUuid: string,
  hint: ProspectHint,
) => {
  const existing = hintsByPersonUuid.get(personUuid) ?? {};
  // Skip explicitly-undefined fields so partial hints (e.g. an avatar tap
  // that only knows the blurhash) don't wipe out richer data already cached
  // by an earlier interaction. To deliberately clear a previously-set field,
  // pass `null` (which we keep) or `false` for booleans.
  const next: ProspectHint = { ...existing };
  const copyDefined = <K extends keyof ProspectHint>(key: K) => {
    const value = hint[key];
    if (value !== undefined) {
      next[key] = value;
    }
  };
  for (const key of Object.keys(hint) as (keyof ProspectHint)[]) {
    copyDefined(key);
  }
  touch(personUuid, next);
};

export const getProspectHint = (
  personUuid: string | undefined | null,
): ProspectHint | undefined => {
  if (!personUuid) return undefined;
  const hint = hintsByPersonUuid.get(personUuid);
  if (hint) touch(personUuid, hint);
  return hint;
};

// Clear all cached prospect hints. Called on sign-out so that the next user
// to sign in on the same browser doesn't briefly see optimistic names/photos
// from the previous user's session.
export const resetProspectHints = () => {
  hintsByPersonUuid.clear();
};
