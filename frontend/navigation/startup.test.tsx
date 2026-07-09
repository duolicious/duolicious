import { jest } from '@jest/globals';
import { Linking as RNLinking } from 'react-native';
import { computeStartupNavigationState } from './startup';
import { createLinking } from './linking';

// Startup navigation reads persisted state when no deep link or notification
// applies; neither store should exist in these tests.
jest.mock('../kv-storage/last-path', () => ({
  lastPath: async () => null,
}));

jest.mock('../kv-storage/navigation-state', () => ({
  consumeLegacyNavigationState: async () => null,
}));

// These tests pin how push notifications are routed at cold start. Payloads
// address screens the same way `navigate` does: root-stack routes by name,
// and nested screens (like the Inbox tab, which "You have a new message"
// targets) via `{screen: 'Home', params: {screen: 'Inbox'}}`. A tab named at
// the root level would be silently dropped during rehydration, dumping the
// user on the default Q&A tab.

describe('computeStartupNavigationState push-notification routing', () => {
  beforeEach(() => {
    jest.spyOn(RNLinking, 'getInitialURL').mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a nested-screen notification (Inbox) becomes the sole root route', async () => {
    const result = await computeStartupNavigationState({
      linking: createLinking(),
      isAuthenticated: true,
      notification: { screen: 'Home', params: { screen: 'Inbox' } },
      pendingClub: null,
    });

    expect(result.initialState).toEqual({
      routes: [{ name: 'Home', params: { screen: 'Inbox' } }],
    });
    expect(result.postLoginRedirectState).toBeNull();
  });

  test('a root-stack notification (Conversation Screen) is pushed over Home with an Inbox back stack', async () => {
    const params = { personUuid: '00000000-0000-0000-0000-000000000000' };

    const result = await computeStartupNavigationState({
      linking: createLinking(),
      isAuthenticated: true,
      notification: { screen: 'Conversation Screen', params },
      pendingClub: null,
    });

    expect(result.initialState).toEqual({
      index: 1,
      routes: [
        { name: 'Home', state: { routes: [{ name: 'Inbox' }] } },
        { name: 'Conversation Screen', params },
      ],
    });
    expect(result.postLoginRedirectState).toBeNull();
  });
});
