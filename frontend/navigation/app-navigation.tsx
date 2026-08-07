import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import {
  NavigationContainerRefWithCurrent,
  NavigationState,
  ParamListBase,
  PartialState,
  getPathFromState as rnGetPathFromState,
} from '@react-navigation/native';
import { lastPath } from '../kv-storage/last-path';
import {
  createLinking,
  focusedConversationHandle,
  focusedProspectHandle,
  focusedRouteIsUnrestorable,
  getTopRouteName,
  bannerRouteTarget,
} from './linking';
import { setActiveConversation } from '../chat/conversation-priority';
import { updateCanonicalUrlOnWeb } from './canonical';
import { setSignUpBanner } from '../events/sign-up-banner';
import {
  getSignedInUser,
  isWebLoggedOut,
  useSignedInUser,
} from '../events/signed-in-user';
import { useNotificationObserverOnMobile } from '../notifications/mobile';
import { useWebPushMessageListenerOnWeb } from '../notifications/web-push';

type AppLinking = ReturnType<typeof createLinking>;

type AppNavigationContainerRef = NavigationContainerRefWithCurrent<ParamListBase>;

type AppNavigation = {
  pendingPostLoginStateRef: MutableRefObject<PartialState<NavigationState> | null>
  onNavigationReady: () => void
  onNavigationStateChange: (state: NavigationState) => void
};

const useAppNavigation = (
  linking: AppLinking,
  navigationContainerRef: AppNavigationContainerRef,
): AppNavigation => {
  const [signedInUser] = useSignedInUser();
  const pendingPostLoginStateRef = useRef<PartialState<NavigationState> | null>(null);

  // Centralised post-sign-in redirect. Runs both when `signedInUser` changes
  // (the post-OTP-flow case) and when the NavigationContainer reports ready
  // (the cold-start-with-existing-session case, where `signedInUser` may
  // have been populated *before* the container mounted, so the effect's
  // ref-lookup would have early-returned).
  //
  // Two responsibilities:
  //   1. If a protected URL was deep-linked while logged-out, restore it
  //      after the user signs in (`pendingPostLoginStateRef`).
  //   2. Otherwise, if the user is parked on the logged-out Welcome stack
  //      (just completed OTP, or typed `/sign-in`/`/welcome` while already
  //      signed in), forward them to the canonical landing tab so they
  //      aren't stranded on the sign-in form.
  const applyPostSignInRedirect = useCallback(() => {
    if (!getSignedInUser()) return;

    const navigationContainer = navigationContainerRef.current;
    if (!navigationContainer) return;

    const pending = pendingPostLoginStateRef.current;
    pendingPostLoginStateRef.current = null;

    if (pending) {
      navigationContainer.reset(pending);
      return;
    }

    if (getTopRouteName(navigationContainer.getRootState?.()) === 'Welcome') {
      navigationContainer.reset({
        routes: [
          { name: 'Home', state: { routes: [{ name: 'Q&A' }] } },
        ],
      });
    }
  }, []);

  const recomputeSignUpBanner = useCallback((state?: NavigationState) => {
    const rootState = state ?? navigationContainerRef.current?.getRootState?.();

    setSignUpBanner({
      target: isWebLoggedOut() ? bannerRouteTarget(rootState) : 'none',
      prospectHandle: focusedProspectHandle(rootState),
    });
  }, []);

  // Tell the chat layer which conversation (if any) is on screen, so on connect
  // it can load an open conversation's history before the inbox snapshot. See
  // `frontend/chat/conversation-priority`.
  const publishActiveConversation = useCallback((state?: NavigationState) => {
    const rootState = state ?? navigationContainerRef.current?.getRootState?.();
    setActiveConversation(focusedConversationHandle(rootState) ?? null);
  }, []);

  // Serializes a navigation state to its canonical path via React
  // Navigation's own `getPathFromState`, so consumers stay in lock-step
  // with whatever URL structure the linking config exposes. Returns null
  // for states that aren't representable as URLs (e.g. mid-transition or
  // screens not in the linking config); those are expected
  // intermittently, so they warn rather than error.
  const pathFromState = useCallback((state?: NavigationState): string | null => {
    const rootState = state ?? navigationContainerRef.current?.getRootState?.();
    if (!rootState) return null;
    try {
      // The `as any` is unfortunate but unavoidable: React Navigation's
      // PathConfig types insist every `screens`-bearing entry also declare
      // its own `path`, but our `Home` deliberately doesn't have one (its
      // children inherit the empty root). The runtime invariant being relied
      // on here is that `Home` is always the implicit root of the path tree,
      // so any path produced by getPathFromState round-trips back to a
      // valid state via getStateFromPath.
      const path = rnGetPathFromState(rootState, linking.config);
      return path.startsWith('/') ? path : `/${path}`;
    } catch (e) {
      console.warn('Failed to serialize navigation state to a path', e);
      return null;
    }
  }, [linking]);

  const syncCanonicalUrl = useCallback((state?: NavigationState) => {
    const path = pathFromState(state);
    if (path !== null) {
      updateCanonicalUrlOnWeb(path);
    }
  }, [pathFromState]);

  const onNavigationReady = useCallback(() => {
    applyPostSignInRedirect();
    recomputeSignUpBanner();
    publishActiveConversation();
    syncCanonicalUrl();
  }, [applyPostSignInRedirect, recomputeSignUpBanner, publishActiveConversation, syncCanonicalUrl]);

  useEffect(() => {
    // On sign-out drop any remaining pending state so a stale entry from
    // this session can't latch onto a subsequent sign-in as a different
    // user on the same browser.
    if (!signedInUser) {
      pendingPostLoginStateRef.current = null;
    } else {
      applyPostSignInRedirect();
    }
    recomputeSignUpBanner();
  }, [signedInUser?.personUuid, applyPostSignInRedirect, recomputeSignUpBanner]);

  const onNavigationStateChange = useCallback(async (state: NavigationState) => {
    if (!state) return;

    recomputeSignUpBanner(state);
    publishActiveConversation(state);
    syncCanonicalUrl(state);

    // URL-bar sync is left entirely to React Navigation's linking integration.
    // Doing a `window.history.replaceState` here in addition to RN's own
    // pushState corrupts the browser history stack: our handler runs
    // synchronously from the state-change emit, while RN's pushState is
    // queued as a microtask, so our replace overwrites the URL of the
    // *previous* browser entry before RN appends a new one - effectively
    // collapsing two history entries into one and breaking the back button.

    // Read auth synchronously rather than closing over `signedInUser`. During
    // sign-out we clear the user before triggering the navigation reset, and
    // a stale closure would persist the post-logout path under the previous
    // identity (or vice versa).
    if (!getSignedInUser()) return;

    // Don't persist URLs that can't be restored: the OptionScreen-backed
    // wizards would hydrate with no payload and immediately `popToTop`, and
    // the gallery would come back as the only route, with no screen under it
    // to close onto. See `UNRESTORABLE_ROUTE_NAMES`. Walking the focused route
    // chain detects these regardless of how deeply nested they are.
    if (focusedRouteIsUnrestorable(state)) return;

    // Persist just the canonical path - not the full navigation tree - so we
    // can restore the user's last place on next startup.
    const path = pathFromState(state);
    if (path !== null) {
      await lastPath(path);
    }
  }, [pathFromState, recomputeSignUpBanner, publishActiveConversation, syncCanonicalUrl]);

  const navigateFromNotification = (
    screen: string,
    params: Record<string, unknown>,
  ) => {
    const navigationContainer = navigationContainerRef.current;

    if (!navigationContainer) return;
    if (!screen) return;

    navigationContainer.navigate(screen, params);
  };

  useNotificationObserverOnMobile(navigateFromNotification);
  useWebPushMessageListenerOnWeb(navigateFromNotification);

  return {
    pendingPostLoginStateRef,
    onNavigationReady,
    onNavigationStateChange,
  };
};

export {
  AppNavigation,
  useAppNavigation,
};
