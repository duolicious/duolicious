// Changing a search filter or answering a Q&A question changes which intros
// match the user's search filters and the match percentages shown in the
// inbox. The inbox is cached, so without a nudge it keeps showing the old
// values until refreshed. We flag the inbox as stale whenever they change and
// let the inbox tab refetch the next time it's focused.

let isStale = false;

const markInboxStale = (): void => {
  isStale = true;
};

// Whether the inbox has gone stale since this was last called. Reading it
// clears the flag, so the inbox tab refreshes exactly once per change.
const consumeStaleInbox = (): boolean => {
  const wasStale = isStale;
  isStale = false;
  return wasStale;
};

export {
  markInboxStale,
  consumeStaleInbox,
};
