import { jest } from '@jest/globals';

// A build before the gallery was made unrestorable could have persisted
// `/gallery/:photoUuid` as the last path. Restoring it brings the gallery back
// as the only route, with no screen underneath to close onto: the back button
// reports "GO_BACK was not handled by any navigator" and restarting the app
// lands right back on it.

const mockStored = { path: null as string | null };

jest.mock('../kv-storage/last-path', () => ({
  lastPath: async (path?: string | null) => {
    if (path === undefined) return mockStored.path;
    mockStored.path = path ?? null;
    return undefined;
  },
}));

jest.mock('../kv-storage/navigation-state', () => ({
  consumeLegacyNavigationState: async () => null,
}));

jest.mock('../events/signed-in-user', () => ({
  getSignedInUser: () => ({ personUuid: 'someone' }),
  isWebLoggedOut: () => false,
}));

import { getPersistedState } from './startup';
import { createLinking } from './linking';

const photoUuid = 'a'.repeat(64);

describe('restoring the last path', () => {
  test('drops a persisted gallery path rather than stranding the user in it', async () => {
    mockStored.path = `/gallery/${photoUuid}`;

    expect(await getPersistedState(createLinking())).toBe(null);
  });

  test('still restores an ordinary path', async () => {
    mockStored.path = '/qa';

    const state = await getPersistedState(createLinking());

    expect(state).not.toBe(null);
  });

  test('still restores a profile, which the gallery is opened from', async () => {
    mockStored.path = '/some-user';

    const state = await getPersistedState(createLinking());

    expect(state).not.toBe(null);
  });
});
