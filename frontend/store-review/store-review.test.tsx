import * as StoreReview from 'expo-store-review';
import type { ChatMessage } from '../chat/application-layer';
import { isMutualConversation, maybeRequestReview } from './store-review';

jest.mock('expo-store-review', () => ({
  isAvailableAsync: jest.fn(async () => true),
  requestReview: jest.fn(async () => {}),
}));

const mockKv: Record<string, string> = {};

jest.mock('../kv-storage/kv-storage', () => ({
  storeKv: async (key: string, value?: string) => {
    if (value === undefined) return mockKv[key] ?? null;
    mockKv[key] = value;
  },
}));

describe('maybeRequestReview', () => {
  const day = 24 * 60 * 60 * 1000;

  it('waits four months between requests', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000 * day);

    await maybeRequestReview();
    now.mockReturnValue(1119 * day);
    await maybeRequestReview();
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1120 * day);
    await maybeRequestReview();
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(2);
  });
});

const message = (fromCurrentUser: boolean, day: number): ChatMessage => ({
  type: 'chat-text',
  text: 'hi',
  from: '',
  to: '',
  id: `${fromCurrentUser}-${day}-${Math.random()}`,
  fromCurrentUser,
  timestamp: new Date(2026, 9, day, 12),
});

const side = (fromCurrentUser: boolean, days: number[]) =>
  days.map((day) => message(fromCurrentUser, day));

describe('isMutualConversation', () => {
  it('accepts 5+ messages from each person on 2+ days each', () => {
    expect(isMutualConversation([
      ...side(true, [1, 1, 1, 2, 2]),
      ...side(false, [1, 1, 2, 2, 2]),
    ])).toBe(true);
  });

  it('rejects a conversation that all happened on one day', () => {
    expect(isMutualConversation([
      ...side(true, [1, 1, 1, 1, 1, 1]),
      ...side(false, [1, 1, 1, 1, 1, 1]),
    ])).toBe(false);
  });

  it('rejects a conversation where one person barely replied', () => {
    expect(isMutualConversation([
      ...side(true, [1, 2, 3, 4, 5, 6, 7, 8]),
      ...side(false, [1, 3, 5, 7]),
    ])).toBe(false);
  });

  it('rejects a conversation where one person only replied on one day', () => {
    expect(isMutualConversation([
      ...side(true, [1, 2, 3, 4, 5]),
      ...side(false, [3, 3, 3, 3, 3]),
    ])).toBe(false);
  });
});
