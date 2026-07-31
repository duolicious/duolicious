import { jest } from '@jest/globals';
import type { DataItem } from './visitors';

jest.mock('../../websocket-layer', () => ({
  send: jest.fn(),
  EV_CHAT_WS_RECEIVE: 'chat-ws-receive',
}));

jest.mock('../../conversation-priority', () => ({
  awaitFocusedConversationFetch: jest.fn(async () => undefined),
}));

const t1 = '2026-08-01T00:00:00+00:00';
const t2 = '2026-08-01T01:00:00+00:00';

const makeItem = (overrides: Partial<DataItem>): DataItem => ({
  person_uuid: 'person-1',
  url_slug: null,
  photo_uuid: null,
  photo_blurhash: null,
  time: t1,
  name: 'Alice',
  age: 25,
  gender: 'Woman',
  location: null,
  is_verified: false,
  match_percentage: 50,
  verification_required_to_view: null,
  is_new: false,
  was_invisible: false,
  ...overrides,
});

describe('visitor badge count', () => {
  let markVisitorsChecked: (time: string) => void;
  let notify: (key: string, data?: unknown) => void;
  let lastEvent: <T>(key: string) => T | undefined;

  beforeEach(() => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const visitors = require('./visitors');
    markVisitorsChecked = visitors.markVisitorsChecked;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const events = require('../../../events/events');
    notify = events.notify;
    lastEvent = events.lastEvent;
  });

  const receiveSnapshot = (data: {
    visited_you: DataItem[],
    you_visited: DataItem[],
    last_visited_at: string | null,
  }) =>
    notify('chat-ws-receive', { duo_visitors: JSON.stringify(data) });

  const receiveDelta = (
    section: 'visited_you' | 'you_visited',
    item: DataItem,
  ) =>
    notify('chat-ws-receive', {
      duo_visitor: {
        '@section': section,
        '@last_visited_at': item.time,
        '#text': JSON.stringify(item),
      },
    });

  test('the badge stays cleared when I visit someone after checking my visitors', () => {
    receiveSnapshot({
      visited_you: [makeItem({ person_uuid: 'visitor-1', is_new: true })],
      you_visited: [],
      last_visited_at: t1,
    });
    expect(lastEvent('num-visitors')).toBe(1);

    markVisitorsChecked(t1);
    expect(lastEvent('num-visitors')).toBe(0);

    receiveDelta('you_visited', makeItem({ person_uuid: 'prospect-1', time: t2 }));
    expect(lastEvent('num-visitors')).toBe(0);
  });

  test('checking my visitors keeps each row’s `is_new` dot until tapped', () => {
    receiveSnapshot({
      visited_you: [makeItem({ person_uuid: 'visitor-1', is_new: true })],
      you_visited: [],
      last_visited_at: t1,
    });

    markVisitorsChecked(t1);
    expect(lastEvent<DataItem>('visited_you-visitor-1')?.is_new).toBe(true);

    receiveDelta('you_visited', makeItem({ person_uuid: 'prospect-1', time: t2 }));
    expect(lastEvent<DataItem>('visited_you-visitor-1')?.is_new).toBe(true);
  });

  test('a visit newer than the checked time still lights the badge', () => {
    receiveSnapshot({
      visited_you: [makeItem({ person_uuid: 'visitor-1', is_new: true })],
      you_visited: [],
      last_visited_at: t1,
    });

    markVisitorsChecked(t1);

    receiveDelta(
      'visited_you',
      makeItem({ person_uuid: 'visitor-2', time: t2, is_new: true }),
    );
    expect(lastEvent('num-visitors')).toBe(1);
  });
});
