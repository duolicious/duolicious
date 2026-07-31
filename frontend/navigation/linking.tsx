import { Platform } from 'react-native';
import {
  LinkingOptions,
  NavigationState,
  NavigatorScreenParams,
  PartialState,
  PathConfig,
  getPathFromState as rnGetPathFromState,
  getStateFromPath as rnGetStateFromPath,
} from '@react-navigation/native';
import { UUID_REGEX_SOURCE } from '../util/util';
import { getSignedInUser, isWebLoggedOut } from '../events/signed-in-user';
import { BannerTarget } from '../events/sign-up-banner';
import { DEEP_LINK_HOSTNAME } from '../env/env';

type WelcomeParamList = {
  'Welcome Screen': { clubName?: string; numUsers?: number } | undefined;
  'Welcome Email Screen': { clubName?: string } | undefined;
  'Create Account Or Sign In Screen': undefined;
};

type SearchFilterParamList = {
  'Search Filter Tab': undefined;
  'Search Filter Option Screen': undefined;
  'Q&A Filter Screen': undefined;
  'Two-way Filters Screen': undefined;
};

type SearchParamList = {
  'Search Screen': undefined;
  'Search Filter Screen': NavigatorScreenParams<SearchFilterParamList> | undefined;
};

type ProfileParamList = {
  'Profile Tab': undefined;
  'Profile Option Screen': undefined;
  'Club Selector': undefined;
  'Invite Picker': undefined;
};

type HomeParamList = {
  'Q&A': undefined;
  Search: NavigatorScreenParams<SearchParamList> | undefined;
  Feed: undefined;
  Inbox: undefined;
  Visitors: undefined;
  Profile: NavigatorScreenParams<ProfileParamList> | undefined;
};

type ProspectParamList = {
  'Prospect Profile': { personUuid: string };
  'In-Depth': { personUuid: string };
};

// The gallery is a root screen rather than a prospect one because it's opened
// from the feed as well, and has to draw over whichever screen opened it for
// the photo to appear to expand out of that screen's preview.
type RootParamList = {
  Welcome: NavigatorScreenParams<WelcomeParamList> | undefined;
  Home: NavigatorScreenParams<HomeParamList> | undefined;
  'Conversation Screen': { personUuid: string };
  'Prospect Profile Screen': NavigatorScreenParams<ProspectParamList> | undefined;
  'Gallery Screen': { photoUuid: string };
  'Invite Screen': { clubName: string };
};

const SLUG_REGEX_SOURCE = '[a-z0-9_-]+';

const PROFILE_SUBROUTES = ['settings', 'clubs', 'invites'];

// Routes that must never be restored on a cold start.
//
// The OptionScreen-backed wizards depend on an in-memory payload that doesn't
// survive a restart, and would `popToTop` immediately.
//
// `Gallery Screen` is an overlay drawn over whichever screen opened it, so
// restoring it as the only route strands the user in a fullscreen photo with
// nothing to go back to.
const UNRESTORABLE_ROUTE_NAMES = new Set([
  'Create Account Or Sign In Screen',
  'Profile Option Screen',
  'Search Filter Option Screen',
  'Gallery Screen',
]);

const GATED_LOGGED_OUT_PATHS = new Set([
  '/feed', '/inbox', '/visitors', '/profile',
]);

type RouteState = NavigationState | PartialState<NavigationState>;

const readPersonUuid = (params: object | undefined): string | undefined =>
  params && 'personUuid' in params && typeof params.personUuid === 'string'
    ? params.personUuid
    : undefined;

const getTopRouteName = (state: RouteState | undefined): string | undefined =>
  state?.routes?.[state?.index ?? 0]?.name;

const focusedProspectHandle = (state: RouteState | undefined): string | undefined => {
  const root = state?.routes?.[state?.index ?? 0];
  if (root?.name !== 'Prospect Profile Screen') return undefined;
  const nested = root.state?.routes?.[root.state?.index ?? 0];
  return readPersonUuid(nested?.params);
};

// The person the focused Conversation Screen is showing, if that's the top
// route. App reports this to the chat layer so it can load an open
// conversation's history before the inbox snapshot on connect. See
// `frontend/chat/conversation-priority`.
const focusedConversationHandle = (state: RouteState | undefined): string | undefined => {
  const root = state?.routes?.[state?.index ?? 0];
  if (root?.name !== 'Conversation Screen') return undefined;
  return readPersonUuid(root.params);
};

const bannerRouteTarget = (state: RouteState | undefined): BannerTarget => {
  const root = state?.routes?.[state?.index ?? 0];
  if (!root) return 'none';
  if (root.name === 'Prospect Profile Screen') return 'prospect';
  if (root.name !== 'Home') return 'none';

  const tab = root.state?.routes?.[root.state?.index ?? 0]?.name;
  return tab === 'Search' ? 'search' : 'none';
};

const focusedRouteIsUnrestorable = (state: RouteState | undefined): boolean => {
  let node: RouteState | undefined = state;
  while (node && Array.isArray(node.routes)) {
    const idx = typeof node.index === 'number' ? node.index : 0;
    const route = node.routes[idx];
    if (!route) return false;
    if (UNRESTORABLE_ROUTE_NAMES.has(route.name)) return true;
    node = route.state;
  }
  return false;
};

const welcomeConfig: PathConfig<WelcomeParamList> = {
  path: '',
  initialRouteName: 'Welcome Screen',
  screens: {
    'Welcome Screen': '',
    'Welcome Email Screen': 'email',
    'Create Account Or Sign In Screen': 'sign-in',
  },
};

const searchFilterConfig: PathConfig<SearchFilterParamList> = {
  path: 'filters',
  initialRouteName: 'Search Filter Tab',
  screens: {
    'Search Filter Tab': '',
    'Search Filter Option Screen': 'edit',
    'Q&A Filter Screen': 'qa',
    'Two-way Filters Screen': 'two-way',
  },
};

const searchConfig: PathConfig<SearchParamList> = {
  path: 'search',
  initialRouteName: 'Search Screen',
  screens: {
    'Search Screen': '',
    'Search Filter Screen': searchFilterConfig,
  },
};

const profileConfig: PathConfig<ProfileParamList> = {
  path: 'profile',
  initialRouteName: 'Profile Tab',
  screens: {
    'Profile Tab': '',
    'Profile Option Screen': 'settings',
    'Club Selector': 'clubs',
    'Invite Picker': 'invites',
  },
};

const homeConfig: PathConfig<HomeParamList> = {
  screens: {
    'Q&A': 'qa',
    Search: searchConfig,
    Feed: 'feed',
    Inbox: 'inbox',
    Visitors: 'visitors',
    Profile: profileConfig,
  },
};

const prospectConfig: PathConfig<ProspectParamList> = {
  screens: {
    'Prospect Profile': `:personUuid(${UUID_REGEX_SOURCE}|${SLUG_REGEX_SOURCE})`,
    'In-Depth': `in-depth/:personUuid(${UUID_REGEX_SOURCE})`,
  },
};

// `Gallery Screen` keeps the `/gallery/:photoUuid` URL it had when it was a
// prospect screen: `Prospect Profile Screen` contributes no path segment of its
// own, so the path was never nested under one.
const linkingConfig: LinkingOptions<RootParamList>['config'] = {
  screens: {
    Welcome: welcomeConfig,
    Home: homeConfig,
    'Conversation Screen': `chat/:personUuid(${UUID_REGEX_SOURCE})`,
    'Prospect Profile Screen': prospectConfig,
    'Gallery Screen': 'gallery/:photoUuid',
    'Invite Screen': 'invite/:clubName',
  },
};

const createLinking = () => {
  const prefixes =
    Platform.OS === 'web'
      ? (typeof window !== 'undefined' && window.location?.origin
          ? [window.location.origin]
          : [])
      : [`https://${DEEP_LINK_HOSTNAME}`, 'app.duolicious://'];

  const getStateFromPath: typeof rnGetStateFromPath = (path, options) => {
    let normalized = path.replace(/\/{2,}/g, '/');

    // The Google sign-in flow redirects to `app.duolicious:/oauthredirect`
    // (expo-auth-session derives this from the package name). On Android that
    // custom-scheme redirect is *also* delivered to the app as a deep link —
    // the scheme is a registered intent filter — so React Navigation's linking
    // sees the path `oauthredirect`. Because the prospect-profile route matches
    // any bare slug (`[a-z0-9_-]+`), it would navigate to a "Profile not found"
    // prospect screen, which `navigateAfterAuth` then preserves over the real
    // post-sign-in redirect. expo-auth-session consumes the redirect separately
    // to finish the token exchange, so this stray deep link carries no routing
    // intent: collapse it to the root and let the post-sign-in redirect take
    // over. (Note the leading slash is optional — the custom scheme has no host,
    // so the extracted path arrives as `oauthredirect`, not `/oauthredirect`.)
    if (/^\/?oauthredirect(?=$|[/?#])/.test(normalized)) normalized = '/';

    if (normalized === '/me' || normalized.startsWith('/me/')) normalized = '/';
    if (normalized === '/welcome' || normalized.startsWith('/welcome/')) normalized = '/';

    const legacyProfile = normalized.match(/^\/profile\/([^/?]+)(\?.*)?$/);
    if (legacyProfile &&
        !PROFILE_SUBROUTES.includes(legacyProfile[1])) {
      normalized = `/${legacyProfile[1]}${legacyProfile[2] ?? ''}`;
    }

    const pathname = normalized.split('?')[0].replace(/\/$/, '') || '/';
    if (pathname === '/' && getSignedInUser()) {
      return rnGetStateFromPath('/qa', options);
    }
    if (pathname === '/' && isWebLoggedOut()) {
      return rnGetStateFromPath('/search', options);
    }
    if (isWebLoggedOut() && GATED_LOGGED_OUT_PATHS.has(pathname)) {
      return rnGetStateFromPath('/search', options);
    }

    const state = rnGetStateFromPath(normalized, options);
    if (state) return state;
    if (getSignedInUser()) return rnGetStateFromPath('/qa', options);
    if (isWebLoggedOut()) return rnGetStateFromPath('/search', options);
    return { routes: [{ name: 'Welcome' }] };
  };

  return {
    prefixes,
    config: linkingConfig,
    getStateFromPath,
    getPathFromState: rnGetPathFromState,
  };
};

type Linking = ReturnType<typeof createLinking>;

export { createLinking, bannerRouteTarget, focusedProspectHandle, focusedConversationHandle, focusedRouteIsUnrestorable, getTopRouteName };
export type {
  Linking,
  RootParamList,
  WelcomeParamList,
  HomeParamList,
  SearchParamList,
  SearchFilterParamList,
  ProfileParamList,
  ProspectParamList,
};
