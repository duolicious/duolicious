import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef } from 'react';
import {
  APPLE_ANDROID_RETURN_URL,
  APPLE_REDIRECT_URI,
  APPLE_WEB_CLIENT_ID,
  GOOGLE_ANDROID_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
  GOOGLE_WEB_CLIENT_ID,
} from '../env/env';

const errorMessage = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string'
    ? e.message
    : undefined;

const errorCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string'
    ? e.code
    : undefined;

// Required so that the OAuth redirect dismisses the in-app browser
// session on iOS / Android. Calling this once at module load is the
// pattern documented by Expo.
WebBrowser.maybeCompleteAuthSession();

// Apple's web callback returns to the SPA with the result in the query
// string, but the navigation container rewrites the URL (stripping those
// params) as soon as it mounts. Snapshot the query at module load - which
// runs on the fresh page load before navigation mounts - so the return can
// still be read once the sign-up modal mounts the welcome flow.
let _appleWebReturnSearch =
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.search
    : '';

// sessionStorage key that carries the nonce (and arbitrary caller
// context) across the full-page redirect to Apple and back. Versioned
// so a future change to the shape doesn't pick up a stale entry left
// over from an older deploy mid-flow.
const _APPLE_PENDING_KEY = 'apple-signin-pending-v1';

type _ApplePending = {
  nonce: string;
  context: Record<string, string>;
};

export type SocialSignInResult =
  | { ok: true; idToken: string }
  | { ok: false; cancelled: boolean; reason?: string };

/**
 * Wraps `expo-auth-session/providers/google` so callers get a single
 * async `promptForIdToken()` instead of the request/response/promptAsync
 * tuple. Configures the request to return an `id_token` directly, which
 * is what the backend's `/sign-in-with-google` endpoint expects.
 */
export const useGoogleSignIn = (): {
  ready: boolean;
  promptForIdToken: () => Promise<SocialSignInResult>;
} => {
  // Google's native (iOS and Android) OAuth clients only permit the
  // authorization code flow — they reject `response_type=id_token` with
  // `unsupported_response_type`. Web clients still accept implicit, so
  // we keep the one-hop flow there and pay the extra token-exchange
  // round trip on native.
  const isNative = Platform.OS !== 'web';

  // The returned `request` is null until the discovery doc loads.
  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID,
    // Web stays on the cheaper implicit flow; native falls through to
    // the default `code` + PKCE flow and exchanges the code below.
    ...(isNative ? {} : { responseType: 'id_token' as const }),
    scopes: ['openid', 'email'],
  });

  // `useAuthRequest` resolves `promptAsync()` with a result object that
  // describes how the prompt was dismissed; for a successful sign-in the
  // id_token only lands on the separate `response` state. We bridge the
  // two with a deferred resolver and dedup so whichever signal arrives
  // first (the response effect for success, the promptAsync return for
  // cancel/error) settles the promise.
  //
  // Each `promptForIdToken()` call gets its own monotonically-increasing
  // id; settle() refuses to resolve unless the caller's id matches the
  // current pending id. That protects against a cross-talk hazard where
  // a stale `response` (or one re-emitted with the same data) could
  // settle a *later* prompt with a *prior* prompt's token.
  const pendingResolveRef = useRef<
    ((r: SocialSignInResult) => void) | null
  >(null);
  const pendingPromptIdRef = useRef<number | null>(null);
  const promptCounterRef = useRef(0);

  const settle = (id: number, r: SocialSignInResult) => {
    if (pendingPromptIdRef.current !== id) return;
    const resolve = pendingResolveRef.current;
    pendingPromptIdRef.current = null;
    pendingResolveRef.current = null;
    if (resolve) resolve(r);
  };

  useEffect(() => {
    if (!response) return;
    // Only handle success here; cancel/error are settled by the
    // promptAsync return below so we don't double-resolve.
    if (response.type !== 'success') return;
    const id = pendingPromptIdRef.current;
    if (id === null) return;

    const params = response.params as Record<string, string>;

    // Web: implicit flow lands the id_token directly on params.
    if (params.id_token) {
      settle(id, { ok: true, idToken: params.id_token });
      return;
    }

    // Native (iOS / Android): code + PKCE. Exchange against Google's
    // token endpoint. Native clients have no secret, so PKCE is the
    // only credential. The clientId on the exchange must match the one
    // used on the authorize request, which `useAuthRequest` picks per
    // platform — mirror that here.
    const code = params.code;
    if (!code || !request) {
      settle(id, { ok: false, cancelled: false, reason: 'No id_token or code in response' });
      return;
    }

    const exchangeClientId =
      Platform.OS === 'ios' ? GOOGLE_IOS_CLIENT_ID : GOOGLE_ANDROID_CLIENT_ID;

    (async () => {
      try {
        const tokenResponse = await AuthSession.exchangeCodeAsync(
          {
            clientId: exchangeClientId,
            code,
            redirectUri: request.redirectUri,
            extraParams: request.codeVerifier
              ? { code_verifier: request.codeVerifier }
              : undefined,
          },
          { tokenEndpoint: 'https://oauth2.googleapis.com/token' },
        );
        const idToken = tokenResponse.idToken;
        if (idToken) {
          settle(id, { ok: true, idToken });
        } else {
          settle(id, {
            ok: false,
            cancelled: false,
            reason: 'No id_token in token response',
          });
        }
      } catch (e: unknown) {
        settle(id, {
          ok: false,
          cancelled: false,
          reason: errorMessage(e) ?? 'Token exchange failed',
        });
      }
    })();
  }, [response]);

  const promptForIdToken = (): Promise<SocialSignInResult> => {
    if (!request) {
      return Promise.resolve({
        ok: false,
        cancelled: false,
        reason: 'Google sign-in not ready',
      });
    }
    return new Promise<SocialSignInResult>((resolve) => {
      const id = ++promptCounterRef.current;
      pendingPromptIdRef.current = id;
      pendingResolveRef.current = resolve;
      promptAsync()
        .then((result) => {
          if (result?.type === 'cancel' || result?.type === 'dismiss') {
            settle(id, { ok: false, cancelled: true });
          } else if (result?.type === 'error') {
            settle(id, {
              ok: false,
              cancelled: false,
              reason: result.error?.message ?? 'Google sign-in error',
            });
          }
          // `success` is intentionally left to the response effect so we
          // wait for the id_token to land on `response.params`.
        })
        .catch((err) => {
          settle(id, {
            ok: false,
            cancelled: false,
            reason: (err as Error).message ?? 'Google sign-in failed',
          });
        });
    });
  };

  return {
    ready: !!request,
    promptForIdToken,
  };
};

export type AppleSignInResult =
  | { ok: true; identityToken: string; nonce: string }
  | { ok: false; cancelled: boolean; reason?: string };

const _APPLE_AUTHORIZE_URL = 'https://appleid.apple.com/auth/authorize';

const _generateNonce = async (): Promise<string> => {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const _buildAppleAuthorizeUrl = (params: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
}): string => {
  const u = new URL(_APPLE_AUTHORIZE_URL);
  u.searchParams.set('client_id', params.clientId);
  u.searchParams.set('redirect_uri', params.redirectUri);
  // `code id_token` is the only response type Apple supports alongside
  // the email scope. We discard the code — the id_token alone is what
  // /sign-in-with-apple verifies.
  u.searchParams.set('response_type', 'code id_token');
  u.searchParams.set('response_mode', 'form_post');
  u.searchParams.set('scope', 'email');
  u.searchParams.set('state', params.state);
  // Echoed verbatim into the issued JWT's `nonce` claim. The backend
  // compares this against the value the client passes alongside the
  // token to bind the JWT to this specific sign-in session.
  u.searchParams.set('nonce', params.nonce);
  return u.toString();
};

/**
 * Sign In with Apple across iOS, Android, and web.
 *
 * - iOS uses the native ASAuthorizationAppleIDProvider via
 *   `expo-apple-authentication`. The token's `aud` is the iOS bundle ID.
 * - Android uses Apple's OAuth web flow against a Services ID inside an
 *   in-app browser. Apple POSTs the result to the backend's
 *   `/auth/apple/callback`, which 302s back to the app's universal-link
 *   return URL with the id_token in a query parameter.
 * - Web uses the same OAuth web flow but as a full-page navigation
 *   (popups are unreliable in iOS Chrome — `window.opener` doesn't
 *   survive the cross-origin hop to appleid.apple.com, and Apple's iOS
 *   bottom-sheet UI doesn't fire the `form_post` redirect at all). The
 *   nonce and caller-provided `context` are stashed in `sessionStorage`
 *   before navigation; after Apple's callback redirects back to the SPA
 *   root, the caller picks them up via `consumePendingAppleWebSignIn()`.
 *
 * `context` is round-tripped through the web redirect so the caller can
 * resume in the same logical flow (e.g. preserve `clubName`) after the
 * full-page navigation has thrown away all in-memory state. iOS and
 * Android resolve synchronously so they ignore it — the caller still
 * has its own closure variables.
 *
 * We deliberately don't request the FULL_NAME scope: the user picks
 * their display name in the onboarding wizard, so asking Apple for it
 * is just an extra data ask we don't need.
 */
export const signInWithApple = async (
  context: Record<string, string> = {},
): Promise<AppleSignInResult> => {
  if (Platform.OS === 'ios') return signInWithAppleNative();
  if (Platform.OS === 'android') return signInWithAppleAndroid();
  return signInWithAppleWeb(context);
};

const signInWithAppleNative = async (): Promise<AppleSignInResult> => {
  // Apple echoes this nonce verbatim into the JWT's `nonce` claim. The
  // backend compares it to the value we send alongside the token to bind
  // the token to this client session.
  const nonce = await _generateNonce();
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce,
    });

    return {
      ok: true,
      identityToken: credential.identityToken ?? '',
      nonce,
    };
  } catch (e: unknown) {
    // ERR_REQUEST_CANCELED is the documented code for the user dismissing
    // the system sheet; don't surface that as an error.
    if (errorCode(e) === 'ERR_REQUEST_CANCELED') {
      return { ok: false, cancelled: true };
    }
    return { ok: false, cancelled: false, reason: errorMessage(e) ?? 'Apple sign-in failed' };
  }
};

const signInWithAppleAndroid = async (): Promise<AppleSignInResult> => {
  // The same random nonce serves two purposes:
  //   1. Bound CSRF check on the redirect (prefix of `state`).
  //   2. Bound JWT check on the server (`nonce` URL param → JWT.nonce claim).
  const nonce = await _generateNonce();
  const state = `${nonce}.android`;

  const authUrl = _buildAppleAuthorizeUrl({
    clientId: APPLE_WEB_CLIENT_ID,
    redirectUri: APPLE_REDIRECT_URI,
    state,
    nonce,
  });

  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(authUrl, APPLE_ANDROID_RETURN_URL);
  } catch (e: unknown) {
    return { ok: false, cancelled: false, reason: errorMessage(e) ?? 'Apple sign-in failed' };
  }

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { ok: false, cancelled: true };
  }
  if (result.type !== 'success') {
    return { ok: false, cancelled: false, reason: 'Apple sign-in failed' };
  }

  const params = _parseQueryParams(result.url);
  const error = params.get('apple_error');
  if (error) {
    return { ok: false, cancelled: false, reason: `Apple: ${error}` };
  }
  const idToken = params.get('apple_id_token');
  const returnedState = params.get('apple_state') ?? '';
  if (!idToken) {
    return { ok: false, cancelled: false, reason: 'Apple sign-in: no id_token in callback' };
  }
  if (!returnedState.startsWith(`${nonce}.`)) {
    return { ok: false, cancelled: false, reason: 'Apple sign-in: invalid state' };
  }

  return { ok: true, identityToken: idToken, nonce };
};

// Web sign-in is a full-page redirect to Apple. Popup-based flows
// don't survive iOS Chrome: `window.opener` is severed across the
// cross-origin hop to appleid.apple.com, and Apple's iOS bottom-sheet
// UI authenticates on-device without firing the `form_post` redirect at
// all. A top-level navigation sidesteps both problems — the SPA simply
// tears down, Apple does its thing, and the backend 302s us back to the
// SPA root with the credential in query params.
//
// State that needs to span the redirect (the CSRF/JWT nonce and any
// caller-provided context like `clubName`) is stashed in sessionStorage
// keyed under `_APPLE_PENDING_KEY`; the symmetric reader is
// `consumePendingAppleWebSignIn()`.
//
// This function returns a Promise that never resolves: the navigation
// is already underway by the time we return, and any callsite `await`
// just blocks until the page is torn down. We don't resolve it locally
// because the result lives in the *next* page load.
const signInWithAppleWeb = async (
  context: Record<string, string>,
): Promise<AppleSignInResult> => {
  // See `signInWithAppleAndroid` — same nonce binds the redirect-time
  // CSRF check (state prefix) and the server-side JWT.nonce verification.
  const nonce = await _generateNonce();
  // The SPA is served on both web.duolicious.app and duolicious.app. The
  // backend's callback must 302 back to the origin the flow started on —
  // the nonce lives in this origin's sessionStorage — so the state names
  // which entry of the backend's redirect allow-list to use.
  const target =
    window.location.hostname === 'duolicious.app' ? 'apex' : 'web';
  const state = `${nonce}.${target}`;

  const authUrl = _buildAppleAuthorizeUrl({
    clientId: APPLE_WEB_CLIENT_ID,
    redirectUri: APPLE_REDIRECT_URI,
    state,
    nonce,
  });

  try {
    const pending: _ApplePending = { nonce, context };
    sessionStorage.setItem(_APPLE_PENDING_KEY, JSON.stringify(pending));
  } catch {
    return {
      ok: false,
      cancelled: false,
      reason: 'Apple sign-in: sessionStorage unavailable',
    };
  }

  window.location.assign(authUrl);

  // The page is navigating away; nothing we resolve here would be
  // observed. Return a never-settling Promise so the caller's `await`
  // simply suspends until the tab tears down.
  return new Promise<AppleSignInResult>(() => {});
};

/**
 * On web, completes the Apple sign-in started by `signInWithApple()`.
 *
 * Call once on mount of whichever screen the backend's
 * `/auth/apple/callback` redirects users back to. If the URL contains
 * `apple_id_token` / `apple_state` / `apple_error`, returns the parsed
 * result alongside the `context` the caller originally passed to
 * `signInWithApple()`. Otherwise returns `null`.
 *
 * Side effects: clears the pending entry from `sessionStorage` and
 * strips the Apple-specific query params from the URL via
 * `history.replaceState`, so a refresh won't re-trigger this codepath.
 * Safe to call on platforms other than web — it's a no-op there.
 */
export const consumePendingAppleWebSignIn = (): {
  result: AppleSignInResult;
  context: Record<string, string>;
} | null => {
  if (Platform.OS !== 'web') return null;
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(_appleWebReturnSearch);
  const idToken = params.get('apple_id_token');
  const error = params.get('apple_error');
  const returnedState = params.get('apple_state');
  if (!idToken && !error && !returnedState) return null;
  _appleWebReturnSearch = '';

  let pending: _ApplePending | null = null;
  try {
    const raw = sessionStorage.getItem(_APPLE_PENDING_KEY);
    if (raw) pending = JSON.parse(raw) as _ApplePending;
  } catch {
    pending = null;
  }
  try {
    sessionStorage.removeItem(_APPLE_PENDING_KEY);
  } catch {}

  // Strip the Apple-specific query params before anything else can
  // observe them — that way a refresh on this screen doesn't re-attempt
  // the sign-in with a now-empty sessionStorage. Preserve any other
  // params that happened to be on the URL.
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('apple_id_token');
    url.searchParams.delete('apple_error');
    url.searchParams.delete('apple_state');
    const cleanSearch = url.searchParams.toString();
    window.history.replaceState(
      null,
      '',
      url.pathname + (cleanSearch ? `?${cleanSearch}` : '') + url.hash,
    );
  } catch {}

  const context = pending?.context ?? {};

  if (!pending) {
    // Apple redirected back but we have no record of having started
    // the flow in this browsing context — most likely a link opened in
    // a fresh tab. Don't trust the token: we can't verify the nonce.
    return {
      result: {
        ok: false,
        cancelled: false,
        reason: 'Apple sign-in: missing local session',
      },
      context,
    };
  }
  if (error) {
    return {
      result: { ok: false, cancelled: false, reason: `Apple: ${error}` },
      context,
    };
  }
  if (!returnedState || !returnedState.startsWith(`${pending.nonce}.`)) {
    return {
      result: { ok: false, cancelled: false, reason: 'Apple sign-in: invalid state' },
      context,
    };
  }
  if (!idToken) {
    return {
      result: {
        ok: false,
        cancelled: false,
        reason: 'Apple sign-in: no id_token in callback',
      },
      context,
    };
  }
  return {
    result: { ok: true, identityToken: idToken, nonce: pending.nonce },
    context,
  };
};

export const hasPendingAppleWebSignIn = (): boolean => {
  if (Platform.OS !== 'web') return false;
  const params = new URLSearchParams(_appleWebReturnSearch);
  return (
    params.has('apple_id_token') ||
    params.has('apple_error') ||
    params.has('apple_state')
  );
};

const _parseQueryParams = (url: string): URLSearchParams => {
  // Some browsers/env may not populate URL.searchParams from a relative-ish
  // string; parse the query manually as a fallback.
  try {
    return new URL(url).searchParams;
  } catch {
    const q = url.split('?')[1] ?? '';
    return new URLSearchParams(q.split('#')[0]);
  }
};
