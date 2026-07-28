import { jest } from '@jest/globals';

type SendRequest = {
  responseDetector?: (doc: unknown) => unknown
};

const mockSend = jest.fn<(request: SendRequest) => Promise<unknown>>();

jest.mock('../websocket-layer', () => ({
  EV_CHAT_WS_CLOSE: 'chat-ws-close',
  EV_CHAT_WS_OPEN: 'chat-ws-open',
  EV_CHAT_WS_RECEIVE: 'chat-ws-receive',
  EV_CHAT_WS_SEND_CLOSE: 'chat-ws-send-close',
  send: mockSend,
}));

jest.mock('../../notifications/notifications', () => ({
  getAndRegisterPushToken: jest.fn(),
}));

const PERSON = '00000000-0000-4000-8000-000000000000';
const T1 = '2026-07-14T10:30:00.000Z';
const T2 = '2026-07-14T11:00:00.000Z';

const wireConversation = (
  lastMessageTimestamp: string,
  lastMessageRead: boolean,
) => ({
  person_uuid: PERSON,
  name: 'Test Person',
  match_percentage: 90,
  last_message: 'hi',
  last_message_read: lastMessageRead,
  last_message_timestamp: lastMessageTimestamp,
  is_available: true,
  is_verified: false,
  location: 'intros',
  matches_search_filters: true,
});

describe('inbox read state vs. server snapshots', () => {
  let events: typeof import('../../events/events');
  let chat: typeof import('./index');

  beforeEach(async () => {
    jest.resetModules();
    mockSend.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    events = require('../../events/events');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    chat = require('./index');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const priority: typeof import('../conversation-priority') =
      require('../conversation-priority');

    mockSend.mockResolvedValue('timeout');
    await chat.login('me', 'password');
    priority.setActiveConversation(null);
  });

  const deliverInboxSnapshot = async (conversations: unknown[]) => {
    mockSend.mockImplementation(async (request) => {
      if (!request.responseDetector) {
        return 'timeout';
      }

      return request.responseDetector({ duo_inbox: { conversations } }) ?? 'timeout';
    });

    await chat.refreshInbox();

    mockSend.mockResolvedValue('timeout');
  };

  const lastMessageRead = (): boolean | null => {
    const conversation = chat.getInbox()?.intros.conversationsMap[PERSON];
    return conversation ? conversation.lastMessageRead : null;
  };

  test('a mark sent while the inbox is loading survives the snapshot', async () => {
    await chat.markDisplayed(PERSON, 'm1', new Date(T1));

    expect(chat.getInbox()).toBeNull();

    await deliverInboxSnapshot([wireConversation(T1, false)]);

    expect(lastMessageRead()).toBe(true);
  });

  test('a stale unread snapshot does not clobber a local mark', async () => {
    await deliverInboxSnapshot([wireConversation(T1, false)]);

    expect(lastMessageRead()).toBe(false);

    await chat.markDisplayed(PERSON, 'm1', new Date(T1));

    expect(lastMessageRead()).toBe(true);

    await deliverInboxSnapshot([wireConversation(T1, false)]);

    expect(lastMessageRead()).toBe(true);
  });

  test('a message newer than the mark stays unread', async () => {
    await chat.markDisplayed(PERSON, 'm1', new Date(T1));
    await deliverInboxSnapshot([wireConversation(T1, false)]);

    expect(lastMessageRead()).toBe(true);

    events.notify('chat-ws-receive', { duo_inbox_entry: wireConversation(T2, false) });

    expect(lastMessageRead()).toBe(false);
  });

  test('a mark without a timestamp is backed by the inbox entry', async () => {
    await deliverInboxSnapshot([wireConversation(T1, false)]);

    await chat.markDisplayed(PERSON, 'm1', null);
    await deliverInboxSnapshot([wireConversation(T1, false)]);

    expect(lastMessageRead()).toBe(true);
  });

  test('logging out clears the marks', async () => {
    await chat.markDisplayed(PERSON, 'm1', new Date(T1));
    await chat.logout();

    await deliverInboxSnapshot([wireConversation(T1, false)]);

    expect(lastMessageRead()).toBe(false);
  });
});

describe('displayed-up-to overlay', () => {
  let overlay: typeof import('./displayed-up-to');

  beforeEach(() => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    overlay = require('./displayed-up-to');
  });

  test('an older mark does not regress a newer one', () => {
    overlay.advanceDisplayedUpTo(PERSON, new Date(T2));
    overlay.advanceDisplayedUpTo(PERSON, new Date(T1));

    expect(overlay.getDisplayedUpTo(PERSON)).toEqual(new Date(T2));
  });

  test('an invalid date is ignored', () => {
    overlay.advanceDisplayedUpTo(PERSON, new Date('not a date'));

    expect(overlay.getDisplayedUpTo(PERSON)).toBeNull();
  });

  test('clearing resets the overlay', () => {
    overlay.advanceDisplayedUpTo(PERSON, new Date(T1));
    overlay.clearDisplayedUpTo();

    expect(overlay.getDisplayedUpTo(PERSON)).toBeNull();
  });
});
