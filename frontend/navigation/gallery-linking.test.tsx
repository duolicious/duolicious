import { getStateFromPath, getPathFromState } from '@react-navigation/native';
import { createLinking } from './linking';

// `/gallery/:photoUuid` is a URL users can already be holding, and the gallery
// moved from the prospect navigator to the root one to be able to draw over the
// feed as well. These pin that the move didn't disturb the URL.

jest.mock('../events/signed-in-user', () => ({
  getSignedInUser: () => ({ personUuid: 'someone' }),
  isWebLoggedOut: () => false,
}));

const photoUuid = 'a'.repeat(64);

describe('the gallery URL', () => {
  test('resolves to the root Gallery Screen', () => {
    const linking = createLinking();

    const state = linking.getStateFromPath(`/gallery/${photoUuid}`, linking.config);

    expect(state?.routes[state.routes.length - 1]).toMatchObject({
      name: 'Gallery Screen',
      params: { photoUuid },
    });
  });

  test('round-trips back to the same path', () => {
    const linking = createLinking();

    const state = getStateFromPath(`/gallery/${photoUuid}`, linking.config);

    expect(state && getPathFromState(state, linking.config))
      .toBe(`/gallery/${photoUuid}`);
  });

  test('is not swallowed by the bare-slug profile route', () => {
    const linking = createLinking();

    // `Prospect Profile` matches any single bare slug, and is declared first.
    // A two-segment gallery path must not be read as a profile named "gallery".
    const state = linking.getStateFromPath(`/gallery/${photoUuid}`, linking.config);

    const names = state?.routes.map((r) => r.name) ?? [];
    expect(names).not.toContain('Prospect Profile Screen');
  });
});
