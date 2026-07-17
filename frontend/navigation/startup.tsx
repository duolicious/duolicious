import { Linking as RNLinking, Platform } from 'react-native';
import { NavigationState, PartialState } from '@react-navigation/native';
import { lastPath } from '../kv-storage/last-path';
import { consumeLegacyNavigationState } from '../kv-storage/navigation-state';
import { ClubItem } from '../club/club';
import type { Linking } from './linking';
import { focusedRouteIsUnrestorable } from './linking';

type NavState = PartialState<NavigationState>;

const ensureLeadingSlash = (p: string): string => {
  if (!p) return '/';
  return p.startsWith('/') ? p : `/${p}`;
};

const isRootPath = (p: string | null | undefined): boolean => {
  if (!p) return true;
  const pathname = p.split('?')[0].replace(/\/$/, '');
  return pathname === '' || pathname === '/';
};

// Screens that don't require an authenticated session. We look at the
// top-level route name directly because `getStateFromPath` returns "stale"
// partial states without `index` / focused-route metadata, which makes
// recursive helpers like `getCurrentScreen` return null.
//
// `Prospect Profile Screen` is conditionally public: the screen mounts for
// everyone, and the backend gates visibility on `public_profile`. The
// screen renders its own 404 state when access is denied.
const PUBLIC_TOP_LEVEL_ROUTES = new Set([
  'Invite Screen',
  'Prospect Profile Screen',
  'Welcome',
]);

const isPublicTopRoute = (state: NavState): boolean => {
  const topRoute = state?.routes?.[0]?.name;
  return typeof topRoute === 'string' && PUBLIC_TOP_LEVEL_ROUTES.has(topRoute);
};

// Root-`Stack.Navigator` siblings of `Home` that get pushed *on top* of the
// home tabs in normal navigation (e.g. tapping a profile inside Search).
// When restoring or deep-linking straight to one of these, we synthesize a
// `Home` entry beneath it so the in-screen back button lands on a sensible
// tab (rather than the default Q&A tab, which is jarring after refreshing
// a conversation or prospect profile). We can't just set `initialRouteName`
// on the root `Stack.Navigator` because the right initial route depends on
// auth state (`Welcome` for signed-out, `Home` for signed-in).
const HOME_BACK_TAB_FOR_TOP_ROUTE: Record<string, string> = {
  'Conversation Screen': 'Inbox',
  'Prospect Profile Screen': 'Search',
};

const withHomeBackStack = (state: NavState, isAuthenticated: boolean = true): NavState => {
  const routes = state?.routes;
  if (!Array.isArray(routes) || routes.length === 0) return state;
  const topName = routes[0]?.name;
  const backTab = HOME_BACK_TAB_FOR_TOP_ROUTE[topName];
  if (!backTab) return state;
  // `Home`'s tabs assume an authenticated user. Without one, back from the
  // prospect profile should drop the user on Welcome, not a broken Q&A tab.
  if (!isAuthenticated && Platform.OS !== 'web') return state;

  // Prepend a synthetic `Home` parent and keep focus on the original top
  // route, which has shifted from index 0 to index 1 (= newRoutes.length - 1).
  // We deliberately overwrite any pre-existing `state.index` because this is
  // only called on root-level states where `index` is conventionally 0.
  const newRoutes = [
    {
      name: 'Home',
      state: { routes: [{ name: backTab }] },
    },
    ...routes,
  ];
  return {
    ...state,
    index: newRoutes.length - 1,
    routes: newRoutes,
  };
};

const getUrlPath = async (): Promise<string | null> => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `${window.location.pathname}${window.location.search ?? ''}`;
  }

  const initialUrl = await RNLinking.getInitialURL();
  if (!initialUrl) return null;

  const url = new URL(initialUrl);
  return `${url.pathname}${url.search ?? ''}`;
};

export async function getUrlInitialState(
  linking: Linking,
): Promise<NavState | null> {
  try {
    const rawPath = await getUrlPath();
    if (isRootPath(rawPath)) return null;

    const state = linking.getStateFromPath(rawPath as string, linking.config);
    if (!state) return null;

    // Some legacy URLs (e.g. `/me`, `/welcome`) normalize down to `/` inside
    // `linking.getStateFromPath`. Treat those as "no deep link" so the
    // persisted-state / last-path restore path can run instead of bouncing
    // the user to the default tab.
    let canonicalPath: string | null = null;
    try {
      canonicalPath = linking.getPathFromState(state, linking.config);
    } catch {
      canonicalPath = null;
    }
    if (canonicalPath !== null && isRootPath(canonicalPath)) return null;

    return state;
  } catch {
    return null;
  }
}

export async function getPersistedState(
  linking: Linking,
): Promise<NavState | null> {
  const stored = await lastPath();

  const fromPath = (p: string): NavState | null => {
    try {
      const state = linking.getStateFromPath(p, linking.config) ?? null;
      // Also checked before persisting, but a path stored by an older build -
      // or by one that persisted a route later made unrestorable - is still
      // out there. Restoring the gallery from one strands the user in a
      // fullscreen photo with nothing underneath to close onto.
      if (focusedRouteIsUnrestorable(state ?? undefined)) return null;
      return state;
    } catch {
      return null;
    }
  };

  if (typeof stored === 'string' && stored.length) {
    return fromPath(stored);
  }

  // Migration: if we haven't stored a path yet, but we do have legacy navigation
  // state, derive the path from it once and persist. The legacy blob is
  // discarded by `consumeLegacyNavigationState` regardless of outcome - we're
  // never reading it again.
  const legacy = await consumeLegacyNavigationState();
  if (!legacy) return null;

  try {
    const path = ensureLeadingSlash(linking.getPathFromState(legacy, linking.config));
    // If the legacy state collapses to the app root there's nothing useful to
    // restore - and persisting `'/'` would just look like a stale entry on
    // every subsequent boot. Drop it.
    if (isRootPath(path)) return null;
    // Round-trip the path through `getStateFromPath` *before* persisting:
    // if the legacy state references screen names or shapes that no longer
    // exist in the current linking config, `getPathFromState` may still
    // happily produce a string that won't deserialise. Persisting it would
    // poison every subsequent startup until the user navigates somewhere
    // else, so verify the path is restorable first.
    const state = fromPath(path);
    if (!state) return null;
    await lastPath(path);
    return state;
  } catch {
    return null;
  }
}

export type StartupNavResult = {
  initialState: NavState;
  postLoginRedirectState: NavState | null;
};

export async function computeStartupNavigationState(args: {
  linking: Linking;
  isAuthenticated: boolean;
  notification: { screen: string; params: Record<string, unknown> } | null;
  pendingClub: ClubItem | null;
}): Promise<StartupNavResult> {
  const { linking, isAuthenticated, notification, pendingClub } = args;

  const loggedOutInitialState = Platform.OS === 'web'
    ? { routes: [{ name: 'Home', state: { routes: [{ name: 'Search' }] } }] }
    : { routes: [{ name: 'Welcome' }] };

  const urlState = await getUrlInitialState(linking);

  if (urlState) {
    if (isAuthenticated || isPublicTopRoute(urlState)) {
      return {
        initialState: withHomeBackStack(urlState, isAuthenticated),
        postLoginRedirectState: null,
      };
    }

    // Protected deep-link while logged out. Stash the full state (including
    // any synthesized `Home` parent) for after they sign in.
    return {
      initialState: loggedOutInitialState,
      postLoginRedirectState: Platform.OS === 'web' ? null : withHomeBackStack(urlState),
    };
  }

  if (!isAuthenticated) {
    return { initialState: loggedOutInitialState, postLoginRedirectState: null };
  }

  // Signed in: prefer push-notification, then pending-club flows, then restore.
  if (notification) {
    return {
      initialState: withHomeBackStack({
        routes: [{ name: notification.screen, params: notification.params }],
      }),
      postLoginRedirectState: null,
    };
  }

  if (pendingClub) {
    return {
      initialState: {
        routes: [
          {
            name: 'Home',
            state: { routes: [{ name: 'Search' }] },
          },
        ],
      },
      postLoginRedirectState: null,
    };
  }

  const persistedState = await getPersistedState(linking);
  if (persistedState) {
    return {
      initialState: withHomeBackStack(persistedState),
      postLoginRedirectState: null,
    };
  }

  return { initialState: { routes: [{ name: 'Home' }] }, postLoginRedirectState: null };
}
