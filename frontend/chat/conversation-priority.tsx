import { lastEvent, listen, nextEvent, notify } from '../events/events';

// ── Focused-conversation priority ────────────────────────────────────────────
//
// When the chat socket connects (or reconnects) with a conversation open, that
// conversation's message history should load *before* the connect-time
// snapshots (the inbox and the visitors list). The chat server processes a
// connection's stanzas sequentially, so sending a (potentially multi-second)
// snapshot query first would stall the messages the user is actually looking
// at.
//
// The mechanism has three touch-points, and only the first lives outside the
// chat layer:
//
//   • `App` calls `setActiveConversation` whenever navigation settles, naming
//     the focused conversation (or `null` when none is open). This is the
//     single source of truth for "what's on screen", and it's reported from the
//     computed startup route before the navigation container even mounts.
//
//   • `fetchConversation` calls `markConversationFetchDispatched` at the moment
//     it puts a history query on the wire. The signal is emitted at the point
//     of truth - the send itself - rather than by the conversation screen, so
//     UI refactors can't silently stop it being sent.
//
//   • The connect-time snapshot queries (the chat layer's `refreshInbox`, the
//     visitors hook's `requestVisitorsSnapshot`) each await
//     `awaitFocusedConversationFetch` themselves, first thing, so the ordering
//     guarantee can't be lost by reworking their call sites. The gate resolves
//     once the focused conversation's history query is on the wire on the
//     current connection - immediately when no conversation is open or the
//     focused one has already fetched - and is bounded by a timeout so a
//     backgrounded or absent conversation screen can never stall the snapshots
//     indefinitely. Any number of callers may await it concurrently, at any
//     time.
//
// The ordering guarantee itself rests on `markConversationFetchDispatched`
// being called in the same synchronous block as the `ws.send` of the history
// query: waiters released by it only resume as microtasks, which cannot run
// until after that block completes, so the history query always reaches the
// socket first.
//
// The event keys and dispatch bookkeeping live entirely in this file; the rest
// of the app only sees the three functions. `conversation-priority.test.tsx`
// pins the hold/release/timeout semantics down.

const ACTIVE_CONVERSATION = 'active-conversation';
const CONVERSATION_FETCH_DISPATCHED = 'conversation-fetch-dispatched';

// How long a snapshot query will wait for the focused conversation to dispatch
// its history query first. A fallback, not the expected path: the conversation
// screen normally requests its first page within a render of coming online, so
// the wait resolves in milliseconds.
const priorityTimeout = 2000;

// Conversations whose history query has been dispatched on the current
// connection. Cleared on disconnect because a fetch from a previous connection
// says nothing about this one - the conversation screen re-fetches when the
// chat comes back online.
const dispatchedThisConnection = new Set<string>();

listen<boolean>('chat-is-online', (isOnline) => {
  if (!isOnline) {
    dispatchedThisConnection.clear();
  }
});

// Report the focused conversation's personUuid, or `null` when none is open.
// Always a concrete value so `awaitFocusedConversationFetch` can tell "no
// conversation focused" (`null`) apart from "navigation hasn't reported yet"
// (`undefined`).
const setActiveConversation = (personUuid: string | null): void => {
  notify<string | null>(ACTIVE_CONVERSATION, personUuid);
};

// Record that `personUuid`'s history query is going onto the wire, releasing
// any snapshot queries held back by `awaitFocusedConversationFetch`. Must be
// called in the same synchronous block as the send (see the overview above).
const markConversationFetchDispatched = (personUuid: string): void => {
  dispatchedThisConnection.add(personUuid);
  notify<string>(CONVERSATION_FETCH_DISPATCHED, personUuid);
};

// Hold the caller (a connect-time snapshot query) until an open conversation's
// history query is on the wire. Resolves immediately when no conversation is
// open, or when the focused one has already fetched on this connection. See
// the overview above.
const awaitFocusedConversationFetch = async (): Promise<void> => {
  const deadline = Date.now() + priorityTimeout;

  // Cold start: the socket can authenticate before React has mounted the
  // navigation container, so the focused conversation may not have been
  // reported yet (`undefined`). Wait, briefly, for the first report rather
  // than assuming no conversation is open and racing ahead.
  let focused = lastEvent<string | null>(ACTIVE_CONVERSATION);
  if (focused === undefined) {
    focused = await nextEvent<string | null>(
      ACTIVE_CONVERSATION,
      deadline - Date.now(),
    );
  }

  if (!focused) {
    return;
  }

  // `markConversationFetchDispatched` updates the set before notifying, so
  // re-checking the set each iteration can't miss a dispatch that lands
  // between waits.
  while (!dispatchedThisConnection.has(focused)) {
    const timeLeft = deadline - Date.now();

    if (timeLeft <= 0) {
      return;
    }

    const dispatched =
      await nextEvent<string>(CONVERSATION_FETCH_DISPATCHED, timeLeft);

    if (dispatched === undefined) {
      return; // Timed out.
    }
  }
};

export {
  awaitFocusedConversationFetch,
  markConversationFetchDispatched,
  setActiveConversation,
};
