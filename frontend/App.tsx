import {
  Platform,
} from 'react-native';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DefaultTheme,
  InitialState,
  NavigationContainer,
  NavigationState,
  ParamListBase,
  PartialState,
  createNavigationContainerRef,
  getPathFromState as rnGetPathFromState,
} from '@react-navigation/native';
import * as Font from 'expo-font';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeTabs } from './components/home-tabs';
import { SplashScreen } from './components/splash-screen';
import { ConversationScreen } from './components/conversation-screen/conversation-screen';
import { ServerStatus, UtilityScreen } from './components/utility-screen';
import { ProspectProfileScreen } from './components/prospect-profile-screen/prospect-profile-screen';
import { InviteScreen, WelcomeScreen } from './components/welcome-screen';
import { sessionToken, sessionPersonUuid } from './kv-storage/session-token';
import { lastPath } from './kv-storage/last-path';
import { clearAllKvExceptSessionToken } from './kv-storage/kv-storage';
import { japi, CLIENT_VERSION } from './api/api';
import { login, logout } from './chat/application-layer';
import { useInboxStats } from './chat/application-layer/hooks/inbox-stats';
import { STATUS_URL } from './env/env';
import { delay } from './util/util';
import { ColorPickerModal } from './components/modal/color-picker-modal/color-picker-modal';
import { GifPickerModal } from './components/modal/gif-picker-modal';
import { ReportModal } from './components/modal/report-modal';
import { ImageCropper } from './components/image-cropper';
import {
  useNotificationObserverOnMobile,
  getLastNotificationResponseOnMobile,
} from './notifications/mobile';
import { usePushTokenListenerOnMobile } from './notifications/notifications';
import { verificationWatcher } from './verification/verification';
import { ClubItem } from './club/club';
import { Toast } from './components/toast';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createLinking, isBannerRoute, focusedProspectHandle, focusedConversationHandle, focusedRouteIsWizard, getTopRouteName } from './navigation/linking';
import { useScrollbarStyle } from './components/navigation/scroll-bar-hooks';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ErrorBoundary } from './components/error-boundary';
import { TooltipListener } from './components/tooltip';
import { VerificationCameraModal } from './components/verification-camera';
import { notify } from './events/events';
import { setActiveConversation } from './chat/conversation-priority';
import { PointOfSaleModal } from './components/modal/point-of-sale-modal';
import { DateOfBirthConfirmationModal } from './components/modal/date-of-birth-confirmation-modal';
import { SignUpModal, showSignUp } from './components/modal/sign-up-modal';
import { SignUpBanner } from './components/sign-up-banner';
import { hasPendingAppleWebSignIn } from './api/social-auth';
import { setSignedInUser, useSignedInUser, getSignedInUser, isWebLoggedOut } from './events/signed-in-user';
import { useAppThemeLoader, useAppTheme } from './app-theme/app-theme';
import { computeStartupNavigationState } from './navigation/startup';
import { resetUserScopedClientState } from './navigation/reset-client-state';

verificationWatcher();

ExpoSplashScreen.preventAutoHideAsync();

type StatusResponse = {
  supported_client_versions: number[];
  statuses: string[];
  status_index: number;
};

type CheckSessionTokenResponse = {
  onboarded?: boolean;
  clubs?: ClubItem[];
  person_id?: number;
  person_uuid?: string;
  pending_club?: ClubItem | null;
  units?: string;
  estimated_end_date?: string;
  name?: string | null;
  has_gold?: boolean;
};

const Stack = createNativeStackNavigator();

const otpDestination = { value: '' };
const isImagePickerOpen = { value: false };

const navigationContainerRef = createNavigationContainerRef<ParamListBase>();

const App = () => {
  const [initialState, setInitialState] = useState<InitialState | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [serverStatus, setServerStatus] = useState<ServerStatus>("ok");
  const [signedInUser] = useSignedInUser();
  const [bannerVisible, setBannerVisible] = useState(false);
  const [bannerProspectHandle, setBannerProspectHandle] = useState<string | undefined>(undefined);
  const pendingPostLoginStateRef = useRef<PartialState<NavigationState> | null>(null);
  useAppThemeLoader();
  const { appTheme } = useAppTheme();

  const linking = useMemo(() => createLinking(), []);

  const loadFonts = useCallback(async () => {
    await Font.loadAsync({
      Trueno: require('./assets/fonts/TruenoRound.otf'),
      TruenoBold: require('./assets/fonts/TruenoRoundBd.otf'),

      MontserratBlack: require('./assets/fonts/montserrat/static/Montserrat-Black.ttf'),
      MontserratBold: require('./assets/fonts/montserrat/static/Montserrat-Bold.ttf'),
      MontserratExtraBold: require('./assets/fonts/montserrat/static/Montserrat-ExtraBold.ttf'),
      MontserratExtraLight: require('./assets/fonts/montserrat/static/Montserrat-ExtraLight.ttf'),
      MontserratLight: require('./assets/fonts/montserrat/static/Montserrat-Light.ttf'),
      MontserratMedium: require('./assets/fonts/montserrat/static/Montserrat-Medium.ttf'),
      MontserratRegular: require('./assets/fonts/montserrat/static/Montserrat-Regular.ttf'),
      MontserratSemiBold: require('./assets/fonts/montserrat/static/Montserrat-SemiBold.ttf'),
      MontserratThin: require('./assets/fonts/montserrat/static/Montserrat-Thin.ttf'),
    });
  }, []);

  const lockScreenOrientation = useCallback(async () => {
    try {
      if (Platform.OS === 'ios' || Platform.OS === 'android') {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);
      }
    } catch (e) {
      console.warn(e);
    }
  }, []);

  const restoreSessionAndNavigate = useCallback(async () => {
    const existingPersonUuid = await sessionPersonUuid();
    const existingSessionToken = await sessionToken();
    const notification = await getLastNotificationResponseOnMobile();

    // `computeStartupNavigationState` owns every routing decision at startup:
    // URL deep-links, public-vs-protected screens, push notifications, the
    // pending-club flow, and persisted last-path restoration. The only thing
    // we still do here is the auth side-effects (token check, logout, set
    // signed-in user) and pass the resulting auth state in.
    const applyStartupNav = async (
      isAuthenticated: boolean,
      pendingClub: ClubItem | null = null,
    ) => {
      const result = await computeStartupNavigationState({
        linking,
        isAuthenticated,
        notification,
        pendingClub,
      });
      if (result.postLoginRedirectState) {
        pendingPostLoginStateRef.current = result.postLoginRedirectState;
      }
      // Report the focused conversation as soon as the startup route is known -
      // before the navigation container mounts - so the chat layer can order an
      // open conversation's history ahead of the inbox without waiting on
      // `onReady`, and doesn't stall the inbox query when no conversation is
      // open. See `frontend/chat/conversation-priority`.
      setActiveConversation(focusedConversationHandle(result.initialState) ?? null);
      setInitialState(result.initialState);
    };

    if (!existingPersonUuid || !existingSessionToken) {
      await sessionPersonUuid(null);
      await sessionToken(null);
      await lastPath(null);
      resetUserScopedClientState();
      setSignedInUser(undefined);
      logout();
      await applyStartupNav(false);
      return;
    }

    if (typeof existingSessionToken !== 'string') {
      return;
    }

    // Log into XMPP
    login(existingPersonUuid, existingSessionToken);

    const response = await japi<CheckSessionTokenResponse>(
      'post',
      '/check-session-token',
      undefined,
      { retryOnTransientError: true }
    );

    const json = response.json;

    if (
      response.clientError ||
      !json ||
      json.onboarded === false ||
      json.person_id === undefined ||
      json.person_uuid === undefined
    ) {
      await sessionPersonUuid(null);
      await sessionToken(null);
      await lastPath(null);
      resetUserScopedClientState();
      setSignedInUser(undefined);
      logout();
      await applyStartupNav(false);
      return;
    }

    const clubs = json.clubs;
    const pendingClub = json.pending_club ?? null;

    setSignedInUser({
      personId: json.person_id,
      personUuid: json.person_uuid,
      units: json.units === 'Imperial' ? 'Imperial' : 'Metric',
      sessionToken: existingSessionToken,
      pendingClub: pendingClub,
      estimatedEndDate: new Date(json.estimated_end_date ?? NaN),
      name: json.name ?? null,
      hasGold: json.has_gold ?? false,
    });

    notify<ClubItem[] | undefined>('updated-clubs', clubs);

    await applyStartupNav(true, pendingClub);
  }, [linking]);

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

  const fetchServerStatusState = useCallback(async () => {
    let response: Response | null = null
    try {
      response = await fetch(STATUS_URL, { cache: 'no-store' });
    } catch (_) {};

    if (response === null || !response.ok) {
      // If even the status server is down, things are *very* not-okay. But odds
      // are it can't be contacted because the user has a crappy internet
      // connection. The "You're offline" notice should still provide some
      // feedback.
      setServerStatus("ok");
      return;
    }

    const j: StatusResponse = await response.json();
    const supportedClientVersions = j.supported_client_versions;
    const reportedStatus = j.statuses[j.status_index];

    const latestServerStatus: ServerStatus = (() => {
      if (reportedStatus === "down for maintenance") {
        return reportedStatus;
      } else if (
        !supportedClientVersions.includes(CLIENT_VERSION)
      ) {
        return "please update";
      } else if (reportedStatus === "ok") {
        return reportedStatus;
      } else {
        return "down for maintenance";
      }
    })();

    if (serverStatus !== latestServerStatus) {
      setServerStatus(latestServerStatus);
    }
  }, [serverStatus]);

  const loadApp = useCallback(async () => {
    await Promise.all([
      loadFonts(),
      lockScreenOrientation(),
      restoreSessionAndNavigate(),
      fetchServerStatusState(),
    ]);

    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadApp();
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (getSignedInUser()) return;
    if (hasPendingAppleWebSignIn()) {
      showSignUp(true);
    }
  }, [isLoading]);

  useEffect(() => {
    // Without this flag, an infinite loop will start each time this effect
    // starts, which would effectively be whenever the server's status changes.
    // That would lead to multiple infinite loops running concurrently.
    let doBreak = false;

    (async () => {
      while (true) {
        await delay(5000);
        await fetchServerStatusState();
        if (doBreak) break;
      }
    })();

    return () => { doBreak = true; };
  }, [fetchServerStatusState]);

  const onError = useCallback(async () => {
    await clearAllKvExceptSessionToken();

    loadApp();
  }, []);

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

    // Don't persist transient wizard URLs. OptionScreen-backed routes
    // (`Profile Option Screen`, `Search Filter Option Screen`,
    // `Create Account Or Sign In Screen`) depend on an in-memory payload
    // that doesn't survive a hard refresh. If we persisted the wizard URL,
    // the next cold-start would hydrate the wizard with no payload and
    // immediately `popToTop` to the parent screen — a visible flicker.
    // Walking the focused route chain lets us detect this regardless of how
    // deeply nested the wizard is.
    if (focusedRouteIsWizard(state)) return;

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

  // Only need live updates on web (for browser tab title)
  const stats = useInboxStats(Platform.OS === 'web');

  const numUnread =
    (stats?.numUnreadChats ?? 0) +
    (stats?.numUnreadIntros ?? 0);

  useNotificationObserverOnMobile((screen: string, params: Record<string, unknown>) => {
    const navigationContainer = navigationContainerRef.current;

    if (!navigationContainer) return;
    if (!screen) return;

    navigationContainer.navigate(screen, params);
  });

  usePushTokenListenerOnMobile();
  useScrollbarStyle();

  useEffect(() => {
    (async () => {
      if (!isLoading || serverStatus !== "ok") {
        await ExpoSplashScreen.hideAsync();
      }
    })();
  }, [isLoading, serverStatus]);

  if (serverStatus !== "ok") {
    return <UtilityScreen serverStatus={serverStatus} />
  }

  const rehydratedInitialState = initialState ?
    { ...initialState, stale: true as const } :
    undefined;

  return (
    <ErrorBoundary onError={onError}>
      <SafeAreaProvider>
        {!isLoading && initialState !== undefined &&
          <GestureHandlerRootView>
            <KeyboardProvider>
            <NavigationContainer
              ref={navigationContainerRef}
              linking={linking}
              initialState={rehydratedInitialState}
              onReady={onNavigationReady}
              onStateChange={onNavigationStateChange}
              theme={{
                ...DefaultTheme,
                colors: {
                  ...DefaultTheme.colors,
                  background: appTheme.primaryColor,
                },
              }}
              documentTitle={{
                // The focused screen can set its own `title` option (e.g. the
                // prospect profile sets it to the prospect's name once the
                // API resolves) and we splice it in front of "Duolicious".
                // Screens that don't set a title fall through to the bare
                // app name.
                formatter: (options) => {
                  const prefix = numUnread ? `(${numUnread}) ` : '';
                  const screenTitle = options?.title;
                  return prefix + (
                    screenTitle ? `${screenTitle} - Duolicious` : 'Duolicious'
                  );
                },
              }}
            >
              <Stack.Navigator
                screenOptions={{
                  headerShown: false,
                  presentation: 'card',
                  navigationBarColor: appTheme.primaryColor,
                }}
              >
                <Stack.Screen
                  name="Welcome"
                  component={WelcomeScreen} />
                <Stack.Screen
                  name="Home"
                  component={HomeTabs} />
                <Stack.Screen
                  name="Conversation Screen"
                  component={ConversationScreen} />
                <Stack.Screen
                  name="Prospect Profile Screen"
                  component={ProspectProfileScreen} />
                <Stack.Screen
                  name="Invite Screen"
                  component={InviteScreen}
                  options={{ title: 'Invitation' }} />
              </Stack.Navigator>
            </NavigationContainer>
            {bannerVisible && <SignUpBanner prospectHandle={bannerProspectHandle}/>}
            <TooltipListener/>
            <ReportModal/>
            <ImageCropper/>
            <ColorPickerModal/>
            <GifPickerModal/>
            <Toast/>
            <PointOfSaleModal/>
            <SignUpModal/>
            <VerificationCameraModal/>
            <DateOfBirthConfirmationModal/>
            </KeyboardProvider>
          </GestureHandlerRootView>
        }
        <SplashScreen loading={isLoading} />
      </SafeAreaProvider>
    </ErrorBoundary>
  );
};

export default App;
export {
  isImagePickerOpen,
  navigationContainerRef,
  otpDestination,
};
