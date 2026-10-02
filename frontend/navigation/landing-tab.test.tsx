import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createLinking } from './linking';
import { navigateAfterAuth } from './navigate-after-auth';
import { HomeTabs } from '../components/home-tabs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

const SEARCH_FIRST = 389200;
const QA_FIRST = 389201;

let mockPersonId: number | undefined;

jest.mock('../events/signed-in-user', () => ({
  getSignedInUser: () =>
    mockPersonId === undefined ? undefined : { personId: mockPersonId },
  useSignedInUser: () => [
    mockPersonId === undefined ? undefined : { personId: mockPersonId },
    () => {},
  ],
  isWebLoggedOut: () => false,
  useIsWebLoggedOut: () => false,
}));

const mockReset = jest.fn();

jest.mock('../App', () => ({
  navigationContainerRef: {
    current: { getRootState: () => ({ routes: [{ name: 'Welcome' }] }) },
    reset: (state: unknown) => mockReset(state),
  },
}));

jest.mock('../components/search-tab', () => ({ SearchTab: () => null }));
jest.mock('../components/quiz-tab', () => ({ QuizTab: () => null }));
jest.mock('../components/profile-tab', () => ({ ProfileTab: () => null }));
jest.mock('../components/inbox-tab', () => ({ InboxTab: () => null }));
jest.mock('../components/feed-tab', () => ({ FeedTab: () => null }));
jest.mock('../components/visitors-tab', () => ({ VisitorsTab: () => null }));
jest.mock('../components/locked-tab', () => ({ LockedTab: () => null }));
jest.mock('../components/navigation/tab-bar', () => ({ TabBar: () => null }));
jest.mock('../components/navigation/web-navigator', () => ({ createWebNavigator: () => null }));

type State = {
  index?: number
  routes: { name: string, state?: State }[]
};

const tabsAt = (personId: number | undefined) => {
  mockPersonId = personId;
  const ref = createNavigationContainerRef();

  act(() => {
    create(
      <NavigationContainer ref={ref}>
        <HomeTabs />
      </NavigationContainer>
    );
  });

  return ref.getRootState();
};

describe('the landing tab', () => {
  beforeEach(() => {
    mockReset.mockClear();
  });

  afterEach(() => {
    mockPersonId = undefined;
  });

  test.each([
    [SEARCH_FIRST, 'Search'],
    [QA_FIRST, 'Q&A'],
  ])('`/` and unknown paths for person %p open %p', (personId, tab) => {
    mockPersonId = personId;
    const linking = createLinking();

    const atRoot = linking.getStateFromPath('/', linking.config) as State;
    const atUnknown = linking.getStateFromPath('/no/such/page', linking.config) as State;

    expect(atRoot.routes[0].name).toBe('Home');
    expect(atRoot.routes[0].state?.routes[0].name).toBe(tab);
    expect(atUnknown.routes[0].state?.routes[0].name).toBe(tab);
  });

  test('an explicit path is kept', () => {
    mockPersonId = SEARCH_FIRST;
    const linking = createLinking();

    const state = linking.getStateFromPath('/feed', linking.config) as State;

    expect(state.routes[0].state?.routes[0].name).toBe('Feed');
  });

  test.each([
    [SEARCH_FIRST, 'Search'],
    [QA_FIRST, 'Q&A'],
  ])('signing up as person %p lands on %p', (personId, tab) => {
    navigateAfterAuth(null, personId, { preserveLocation: false });

    expect(mockReset).toHaveBeenCalledWith({
      routes: [{ name: 'Home', state: { routes: [{ name: tab }] } }],
    });
  });

  test.each([
    [SEARCH_FIRST, 'Search'],
    [QA_FIRST, 'Q&A'],
    [undefined, 'Q&A'],
  ])('the home tabs open person %p on %p, with Q&A first either way', (personId, tab) => {
    const state = tabsAt(personId);

    expect(state.routes[state.index].name).toBe(tab);
    expect(state.routes.map((r) => r.name)).toEqual(
      ['Q&A', 'Search', 'Feed', 'Inbox', 'Visitors', 'Profile'],
    );
  });
});
