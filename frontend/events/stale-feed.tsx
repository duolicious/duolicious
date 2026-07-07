// Changing your gender, your preferred genders, or your preferred ages
// changes which people your feed contains and how they're ranked. The feed
// tab caches its results, so without a nudge it keeps showing the old feed
// until refreshed. We flag the feed as stale whenever those change and let
// the feed tab refetch the next time it's focused.

let isStale = false;

const markFeedStale = (): void => {
  isStale = true;
};

// Whether the feed has gone stale since this was last called. Reading it
// clears the flag, so the feed tab refreshes exactly once per change.
const consumeStaleFeed = (): boolean => {
  const wasStale = isStale;
  isStale = false;
  return wasStale;
};

export {
  markFeedStale,
  consumeStaleFeed,
};
