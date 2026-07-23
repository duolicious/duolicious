import { makeSeenHint } from './seen-hint';

// Whether the signed-in account has seen (or dismissed) the hint pointing at
// the inbox's search-filter button. See `makeSeenHint` for the semantics.
const seenInboxFilterHint = makeSeenHint('seen_inbox_filter_hint');

export {
  seenInboxFilterHint,
};
