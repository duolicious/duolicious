import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
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
  isBannerRoute,
} from './linking';
import { setActiveConversation } from '../chat/conversation-priority';
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
  bannerVisible: boolean
  bannerProspectHandle: string | undefined
  onNavigationReady: () => void
  onNavigationStateChange: (state: NavigationState) => void
};

const useAppNavigation = (
  linking: AppLinking,
  navigationContainerRef: AppNavigationContainerRef,
): AppNavigation => {
  const [signedInUser] = useSignedInUser();
  const [bannerVisible, setBannerVisible] = useState(false);
  const [bannerProspectHandle, setBannerProspectHandle] = useState<string | undefined>(undefined);
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

  const recomputeBannerVisible = useCallback((state?: NavigationState) => {
    const rootState = state ?? navigationContainerRef.current?.getRootState?.();
    setBannerVisible(isWebLoggedOut() && isBannerRoute(rootState));
    setBannerProspectHandle(focusedProspectHandle(rootState));
  }, []);

  // Tell the chat layer which conversation (if any) is on screen, so on connect
  // it can load an open conversation's history before the inbox snapshot. See
  // `frontend/chat/conversation-priority`.
  const publishActiveConversation = useCallback((state?: NavigationState) => {
    const rootState = state ?? navigationContainerRef.current?.getRootState?.();
    setActiveConversation(focusedConversationHandle(rootState) ?? null);
  }, []);

  const onNavigationReady = useCallback(() => {
    applyPostSignInRedirect();
    recomputeBannerVisible();
    publishActiveConversation();
  }, [applyPostSignInRedirect, recomputeBannerVisible, publishActiveConversation]);

  useEffect(() => {
    // On sign-out drop any remaining pending state so a stale entry from
    // this session can't latch onto a subsequent sign-in as a different
    // user on the same browser.
    if (!signedInUser) {
      pendingPostLoginStateRef.current = null;
    } else {
      applyPostSignInRedirect();
    }
    recomputeBannerVisible();
  }, [signedInUser?.personUuid, applyPostSignInRedirect, recomputeBannerVisible]);

  const onNavigationStateChange = useCallback(async (state: NavigationState) => {
    if (!state) return;

    recomputeBannerVisible(state);
    publishActiveConversation(state);

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
    // can restore the user's last place on next startup. We let React
    // Navigation's `getPathFromState` do the serialization so this stays in
    // lock-step with whatever URL structure the linking config exposes.
    try {
      // The `as any` is unfortunate but unavoidable: React Navigation's
      // PathConfig types insist every `screens`-bearing entry also declare
      // its own `path`, but our `Home` deliberately doesn't have one (its
      // children inherit the empty root). The runtime invariant being relied
      // on here is that `Home` is always the implicit root of the path tree,
      // so any path produced by getPathFromState round-trips back to a
      // valid state via getStateFromPath.
      const path = rnGetPathFromState(state, linking.config);
      if (typeof path === 'string') {
        await lastPath(path.startsWith('/') ? path : `/${path}`);
      }
    } catch (e) {
      // Some transient navigation states aren't representable as URLs (e.g.
      // mid-transition or screens not in the linking config). Skip those
      // and warn so misconfiguration doesn't silently break last-path
      // restoration in production - but use `warn` rather than `error`
      // because intermittent failures on transient states are expected.
      console.warn('Failed to persist last navigation path', e);
    }
  }, [linking, recomputeBannerVisible, publishActiveConversation]);

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
    bannerVisible,
    bannerProspectHandle,
    onNavigationReady,
    onNavigationStateChange,
  };
};

export {
  AppNavigation,
  useAppNavigation,
};
