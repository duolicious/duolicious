import { jest } from '@jest/globals';
import { Platform } from 'react-native';
import { findFocusedRoute } from '@react-navigation/native';
import { createLinking } from './linking';
import { signUpUtms, withSignUpUtms, withoutUtms } from './sign-up-utm';

let mockSignedIn = false;

jest.mock('../events/signed-in-user', () => ({
  getSignedInUser: () => (mockSignedIn ? { personUuid: 'someone' } : undefined),
  isWebLoggedOut: () => !mockSignedIn,
}));

const setPlatform = (OS: string) =>
  Object.defineProperty(Platform, 'OS', { value: OS, configurable: true });

const setSearch = (search: string) =>
  Object.defineProperty(window, 'location', {
    value: { search },
    configurable: true,
  });

const focusedRoute = (linking: ReturnType<typeof createLinking>, path: string) => {
  const state = linking.getStateFromPath(path, linking.config);
  if (!state) throw new Error(`no state for ${path}`);
  return { state, route: findFocusedRoute(state) };
};

describe('sign-up UTMs on web', () => {
  beforeAll(() => setPlatform('web'));
  afterAll(() => setPlatform('ios'));

  beforeEach(() => {
    mockSignedIn = false;
    setSearch('?utm_source=reddit&utm_medium=social&utm_term=&ref=abc');
  });

  test('signUpUtms reads only the non-empty UTM parameters', () => {
    expect(signUpUtms()).toEqual({ utm_source: 'reddit', utm_medium: 'social' });
  });

  test('signUpUtms truncates long values', () => {
    setSearch(`?utm_campaign=${'a'.repeat(300)}`);
    expect(signUpUtms().utm_campaign).toHaveLength(256);
  });

  test('a redirected entry URL keeps its UTMs and nothing else', () => {
    const linking = createLinking();
    const { state, route } = focusedRoute(linking, '/?utm_source=reddit&ref=abc');
    expect(route).toMatchObject({ name: 'Search Screen', params: { utm_source: 'reddit' } });
    expect(linking.getPathFromState(state, linking.config))
      .toBe('/search?utm_source=reddit&utm_medium=social');
  });

  test('navigating while signed out carries the UTMs in the URL', () => {
    const linking = createLinking();
    const { state } = focusedRoute(linking, '/email');
    expect(linking.getPathFromState(state, linking.config))
      .toBe('/email?utm_source=reddit&utm_medium=social');
  });

  test('withSignUpUtms keeps the path’s own query', () => {
    expect(withSignUpUtms('/x?a=1')).toBe('/x?a=1&utm_source=reddit&utm_medium=social');
  });

  test('withSignUpUtms drops the UTMs once signed in', () => {
    mockSignedIn = true;
    expect(withSignUpUtms('/qa')).toBe('/qa');
  });

  test('withSignUpUtms leaves the path untouched when the URL has no UTMs', () => {
    setSearch('?ref=abc');
    expect(withSignUpUtms('/qa?a=b%20c')).toBe('/qa?a=b%20c');
  });

  test('withoutUtms strips the UTMs and keeps the rest', () => {
    expect(withoutUtms('/qa?utm_source=reddit&a=1&utm_medium=social')).toBe('/qa?a=1');
    expect(withoutUtms('/qa?utm_source=reddit')).toBe('/qa');
  });
});

describe('sign-up UTMs on native', () => {
  test('there are none to send', () => {
    expect(signUpUtms()).toEqual({});
    expect(withSignUpUtms('/qa')).toBe('/qa');
  });
});
