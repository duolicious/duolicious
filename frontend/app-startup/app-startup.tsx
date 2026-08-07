import { Platform } from 'react-native';
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  InitialState,
  NavigationState,
  PartialState,
} from '@react-navigation/native';
import * as Font from 'expo-font';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { sessionToken, sessionPersonUuid } from '../kv-storage/session-token';
import { lastPath } from '../kv-storage/last-path';
import { clearAllKvExceptSessionToken } from '../kv-storage/kv-storage';
import { japi, CLIENT_VERSION } from '../api/api';
import { login, logout } from '../chat/application-layer';
import { STATUS_URL } from '../env/env';
import { delay } from '../util/util';
import { getLastNotificationResponseOnMobile } from '../notifications/mobile';
import { ClubItem } from '../club/club';
import { ServerStatus } from '../components/utility-screen';
import { notify, useDerivedEvent } from '../events/events';
import { EV_NETWORK_IS_ONLINE } from '../network/network';
import { setActiveConversation } from '../chat/conversation-priority';
import { setSignedInUser, getSignedInUser } from '../events/signed-in-user';
import { computeStartupNavigationState } from '../navigation/startup';
import { createLinking, focusedConversationHandle } from '../navigation/linking';
import { resetUserScopedClientState } from '../navigation/reset-client-state';
import { hasPendingAppleWebSignIn } from '../api/social-auth';
import { adoptWebSessionOnApex } from '../kv-storage/session-bridge';
import { showSignUp } from '../components/modal/sign-up-modal';

ExpoSplashScreen.preventAutoHideAsync();

type AppLinking = ReturnType<typeof createLinking>;

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

type AppStartup = {
  initialState: InitialState | undefined
  isLoading: boolean
  localReady: boolean
  serverStatus: ServerStatus
  onError: () => void
};

const loadFonts = async () => {
  await Font.loadAsync({
    Trueno: require('../assets/fonts/TruenoRound.otf'),
    TruenoBold: require('../assets/fonts/TruenoRoundBd.otf'),

    MontserratBlack: require('../assets/fonts/montserrat/static/Montserrat-Black.ttf'),
    MontserratBold: require('../assets/fonts/montserrat/static/Montserrat-Bold.ttf'),
    MontserratExtraBold: require('../assets/fonts/montserrat/static/Montserrat-ExtraBold.ttf'),
    MontserratExtraLight: require('../assets/fonts/montserrat/static/Montserrat-ExtraLight.ttf'),
    MontserratLight: require('../assets/fonts/montserrat/static/Montserrat-Light.ttf'),
    MontserratMedium: require('../assets/fonts/montserrat/static/Montserrat-Medium.ttf'),
    MontserratRegular: require('../assets/fonts/montserrat/static/Montserrat-Regular.ttf'),
    MontserratSemiBold: require('../assets/fonts/montserrat/static/Montserrat-SemiBold.ttf'),
    MontserratThin: require('../assets/fonts/montserrat/static/Montserrat-Thin.ttf'),
  });
};

const lockScreenOrientation = async () => {
  try {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);
    }
  } catch (e) {
    console.warn(e);
  }
};

const fetchServerStatus = async (): Promise<ServerStatus> => {
  let response: Response | null = null
  try {
    response = await fetch(STATUS_URL, { cache: 'no-store' });
  } catch (_) {};

  if (response === null || !response.ok) {
    // If even the status server is down, things are *very* not-okay. But odds
    // are it can't be contacted because the user has a crappy internet
    // connection. The "You're offline" notice should still provide some
    // feedback.
    return "ok";
  }

  const j: StatusResponse = await response.json();
  const supportedClientVersions = j.supported_client_versions;
  const reportedStatus = j.statuses[j.status_index];

  if (reportedStatus === "down for maintenance") {
    return reportedStatus;
  } else if (!supportedClientVersions.includes(CLIENT_VERSION)) {
    return "please update";
  } else if (reportedStatus === "ok") {
    return reportedStatus;
  } else {
    return "down for maintenance";
  }
};

const useAppStartup = (
  linking: AppLinking,
  pendingPostLoginStateRef: MutableRefObject<PartialState<NavigationState> | null>,
): AppStartup => {
  const [initialState, setInitialState] = useState<InitialState | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [localReady, setLocalReady] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus>("ok");
  const isOffline = useDerivedEvent<boolean, boolean>(
    EV_NETWORK_IS_ONLINE,
    (isOnline) => isOnline === false,
    [],
  );

  const restoreSessionAndNavigate = useCallback(async () => {
    await adoptWebSessionOnApex();

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

  const loadApp = useCallback(async () => {
    // The splash screen may hide once the work that doesn't need the network
    // is done; the network-dependent work below can stall indefinitely
    // offline, which is what the `isOffline` arm of the hide condition
    // bypasses.
    const localWork = Promise.all([
      loadFonts(),
      lockScreenOrientation(),
    ])
      .catch((e) => console.warn(e))
      .then(() => setLocalReady(true));

    await Promise.all([
      localWork,
      restoreSessionAndNavigate(),
      fetchServerStatus().then(setServerStatus),
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

  // Poll the server status. The flag stops the loop when the effect is torn
  // down, so remounts can't accumulate concurrent loops.
  useEffect(() => {
    let doBreak = false;

    (async () => {
      while (true) {
        await delay(5000);
        setServerStatus(await fetchServerStatus());
        if (doBreak) break;
      }
    })();

    return () => { doBreak = true; };
  }, []);

  const onError = useCallback(async () => {
    await clearAllKvExceptSessionToken();

    loadApp();
  }, []);

  // The `isOffline` arm: an offline user with a session token would otherwise
  // be stuck behind the native splash screen with no feedback, since `loadApp`
  // retries `/check-session-token` until the network returns.
  useEffect(() => {
    (async () => {
      if (!localReady) {
        return;
      }

      if (!isLoading || serverStatus !== "ok" || isOffline) {
        await ExpoSplashScreen.hideAsync();
      }
    })();
  }, [localReady, isLoading, serverStatus, isOffline]);

  return { initialState, isLoading, localReady, serverStatus, onError };
};

export {
  AppStartup,
  useAppStartup,
};
