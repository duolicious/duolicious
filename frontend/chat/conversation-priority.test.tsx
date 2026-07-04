import { jest } from '@jest/globals';

jest.useFakeTimers();

// These tests pin down the connect-time ordering guarantee: when the app comes
// online with a conversation open, the inbox/visitors snapshot queries are held
// back until that conversation's history query has been dispatched. Losing
// this doesn't break anything visibly - the app just gets slower for users
// with big inboxes whenever a conversation is the first thing on screen -
// which is exactly why it's pinned by tests.

describe('conversation-priority', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let priority: any;
  let events: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeEach(() => {
    // Reset modules and import fresh instances so each test starts with a
    // clean event bus and dispatch bookkeeping. `jest.resetModules()` operates
    // on the CommonJS require cache, so we deliberately use `require` here
    // rather than ES `import` (which is hoisted and wouldn't pick up the reset
    // module instance).
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    priority = require('./conversation-priority');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    events = require('../events/events');
    jest.clearAllTimers();
  });

  // Let promise chains settle without advancing the (fake) clock.
  const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  };

  // Runs the gate and reports whether it has resolved yet.
  const startWaiting = () => {
    const state = { released: false };
    priority.awaitFocusedConversationFetch().then(() => {
      state.released = true;
    });
    return state;
  };

  test('resolves immediately when no conversation is open', async () => {
    priority.setActiveConversation(null);

    const gate = startWaiting();
    await flushMicrotasks();

    expect(gate.released).toBe(true);
  });

  test('holds snapshots until the focused conversation fetch dispatches', async () => {
    priority.setActiveConversation('person-a');

    const gate = startWaiting();
    await flushMicrotasks();
    expect(gate.released).toBe(false);

    priority.markConversationFetchDispatched('person-a');
    await flushMicrotasks();
    expect(gate.released).toBe(true);
  });

  test('ignores dispatches for other conversations', async () => {
    priority.setActiveConversation('person-a');

    const gate = startWaiting();

    priority.markConversationFetchDispatched('person-b');
    await flushMicrotasks();
    expect(gate.released).toBe(false);

    priority.markConversationFetchDispatched('person-a');
    await flushMicrotasks();
    expect(gate.released).toBe(true);
  });

  test('releases all concurrent waiters', async () => {
    priority.setActiveConversation('person-a');

    const gates = [startWaiting(), startWaiting()];
    await flushMicrotasks();
    expect(gates.map((g) => g.released)).toEqual([false, false]);

    priority.markConversationFetchDispatched('person-a');
    await flushMicrotasks();
    expect(gates.map((g) => g.released)).toEqual([true, true]);
  });

  test('resolves immediately when the focused conversation already fetched', async () => {
    priority.setActiveConversation('person-a');
    priority.markConversationFetchDispatched('person-a');

    // A mid-session call (e.g. `refreshInbox` after an unskip) mustn't be
    // delayed by the connect-time gate.
    const gate = startWaiting();
    await flushMicrotasks();

    expect(gate.released).toBe(true);
  });

  test('waits for navigation to report before assuming no conversation is open', async () => {
    // Cold start: the gate can be entered before App has reported anything.
    const gate = startWaiting();
    await flushMicrotasks();
    expect(gate.released).toBe(false);

    priority.setActiveConversation(null);
    await flushMicrotasks();
    expect(gate.released).toBe(true);
  });

  test('times out rather than stalling snapshots forever', async () => {
    priority.setActiveConversation('person-a');

    const gate = startWaiting();
    await flushMicrotasks();
    expect(gate.released).toBe(false);

    jest.advanceTimersByTime(2000);
    await flushMicrotasks();
    expect(gate.released).toBe(true);
  });

  test('forgets dispatches from previous connections', async () => {
    priority.setActiveConversation('person-a');
    priority.markConversationFetchDispatched('person-a');

    // Going offline invalidates the fetch; the reconnect must wait for a
    // fresh one.
    events.notify('chat-is-online', false);

    const gate = startWaiting();
    await flushMicrotasks();
    expect(gate.released).toBe(false);

    priority.markConversationFetchDispatched('person-a');
    await flushMicrotasks();
    expect(gate.released).toBe(true);
  });
});
