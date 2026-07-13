import { jest } from '@jest/globals';

jest.mock('../../websocket-layer', () => ({
  EV_CHAT_WS_RECEIVE: 'chat-ws-receive',
}));

const PERSON = 'person-1';
const READ_AT_KEY = `read-receipt-at-${PERSON}`;

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
