import { jest } from '@jest/globals';

jest.mock('../../websocket-layer', () => ({
  EV_CHAT_WS_RECEIVE: 'chat-ws-receive',
}));

const PERSON = 'person-1';
const READ_AT_KEY = `read-receipt-at-${PERSON}`;
const OWN_LAST_MESSAGE_KEY = `conversation-own-last-message-at-${PERSON}`;

const readReceiptDoc = (stamp?: string) => ({
  message: {
    '@type': 'read-receipt',
    '@from': `${PERSON}@duolicious.app`,
    ...(stamp ? { displayed: { '@stamp': stamp } } : {}),
  },
});

describe('read receipt resolution', () => {
  let events: typeof import('../../../events/events');

  const receive = (doc: unknown) => events.notify('chat-ws-receive', doc);

  const readAt = (): Date | null =>
    events.lastEvent<Date | null>(READ_AT_KEY) ?? null;

  beforeEach(() => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    events = require('../../../events/events');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./read-receipt');
  });

  test('a stamped receipt records the stamped time', () => {
    const stamp = '2026-07-14T10:30:00.000Z';

    receive(readReceiptDoc(stamp));

    expect(readAt()).toEqual(new Date(stamp));
  });

  test('a newer stamped receipt advances the read time', () => {
    receive(readReceiptDoc('2026-07-14T10:30:00.000Z'));

    receive(readReceiptDoc('2026-07-14T11:00:00.000Z'));

    expect(readAt()).toEqual(new Date('2026-07-14T11:00:00.000Z'));
  });

  test('an older stamped receipt does not move the read time backward', () => {
    receive(readReceiptDoc('2026-07-14T11:00:00.000Z'));

    receive(readReceiptDoc('2026-07-14T10:30:00.000Z'));

    expect(readAt()).toEqual(new Date('2026-07-14T11:00:00.000Z'));
  });

  test('an unstamped receipt is ignored', () => {
    receive(readReceiptDoc());

    expect(readAt()).toBeNull();
  });
});

describe('own last message tracking', () => {
  let events: typeof import('../../../events/events');
  let readReceipt: typeof import('./read-receipt');

  const receive = (doc: unknown) => events.notify('chat-ws-receive', doc);

  const ownLastMessageAt = (): Date | null =>
    events.lastEvent<Date | null>(OWN_LAST_MESSAGE_KEY) ?? null;

  const chatMessageDoc = (from: string = PERSON) => ({
    message: {
      '@type': 'chat',
      '@from': `${from}@duolicious.app`,
    },
  });

  beforeEach(() => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    events = require('../../../events/events');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    readReceipt = require('./read-receipt');
  });

  test('a published own last message is retained', () => {
    const timestamp = new Date('2026-07-14T10:30:00.000Z');

    readReceipt.notifyOwnLastMessageAt(PERSON, timestamp);

    expect(ownLastMessageAt()).toEqual(timestamp);
  });

  test('an incoming chat message clears the own last message', () => {
    readReceipt.notifyOwnLastMessageAt(
      PERSON, new Date('2026-07-14T10:30:00.000Z'));

    receive(chatMessageDoc());

    expect(ownLastMessageAt()).toBeNull();
  });

  test('a chat message from another conversation leaves it alone', () => {
    const timestamp = new Date('2026-07-14T10:30:00.000Z');
    readReceipt.notifyOwnLastMessageAt(PERSON, timestamp);

    receive(chatMessageDoc('person-2'));

    expect(ownLastMessageAt()).toEqual(timestamp);
  });

  test('a read receipt leaves the own last message alone', () => {
    const timestamp = new Date('2026-07-14T10:30:00.000Z');
    readReceipt.notifyOwnLastMessageAt(PERSON, timestamp);

    receive(readReceiptDoc('2026-07-14T11:00:00.000Z'));

    expect(ownLastMessageAt()).toEqual(timestamp);
  });
});
