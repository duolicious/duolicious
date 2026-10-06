import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createLinking } from './linking';
import { navigateAfterAuth } from './navigate-after-auth';
import { HomeTabs } from '../components/home-tabs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

jest.mock('../events/signed-in-user', () => ({
  getSignedInUser: () => ({ personId: 1 }),
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

const homeTabs = () => {
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

  test('`/` and unknown paths open Search', () => {
    const linking = createLinking();

    const atRoot = linking.getStateFromPath('/', linking.config) as State;
    const atUnknown = linking.getStateFromPath('/no/such/page', linking.config) as State;

    expect(atRoot.routes[0].name).toBe('Home');
    expect(atRoot.routes[0].state?.routes[0].name).toBe('Search');
    expect(atUnknown.routes[0].state?.routes[0].name).toBe('Search');
  });

  test('an explicit path is kept', () => {
    const linking = createLinking();

    const state = linking.getStateFromPath('/feed', linking.config) as State;

    expect(state.routes[0].state?.routes[0].name).toBe('Feed');
  });

  test('signing up lands on Search', () => {
    navigateAfterAuth(null, { preserveLocation: false });

    expect(mockReset).toHaveBeenCalledWith({
      routes: [{ name: 'Home', state: { routes: [{ name: 'Search' }] } }],
    });
  });

  test('the home tabs open on Search, with Q&A first', () => {
    const state = homeTabs();

    expect(state.routes[state.index].name).toBe('Search');
    expect(state.routes.map((r) => r.name)).toEqual(
      ['Q&A', 'Search', 'Feed', 'Inbox', 'Visitors', 'Profile'],
    );
  });
});
