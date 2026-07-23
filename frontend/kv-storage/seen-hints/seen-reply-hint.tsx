import { makeSeenHint } from './seen-hint';

// Whether the signed-in account has seen (or dismissed) the reply hint on
// prospect profiles. See `makeSeenHint` for the semantics.
const seenReplyHint = makeSeenHint('seen_reply_hint');

export {
  seenReplyHint,
};
