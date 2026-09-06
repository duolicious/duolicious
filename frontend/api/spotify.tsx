import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { japi } from './api';
import { parseQueryParams, takeWebReturnParams } from './oauth-return';
import { DEEP_LINK_HOSTNAME } from '../env/env';
import { notify } from '../events/events';
import { ValidationErrorToast } from '../components/toast';
import { patchProfileInfo, refreshProfileInfo } from '../events/profile-info';

type PostSpotifyAuthorizeResponse = {
  authorize_url?: string
};

const notifyError = (error: string) =>
  notify<React.FC>('toast', () => <ValidationErrorToast error={error} />);

const notifyConnectFailed = () =>
  notifyError('Couldn’t connect Spotify. Try again later.');

// Returns whether the connect succeeded and toasts when it failed. Denial is
// the user's own action, so it's silent. The error string in the query is
// never shown: anyone can put anything there.
const consumeReturnParams = (params: URLSearchParams): boolean => {
  const connected = params.get('spotify') === 'connected';
  if (!connected && params.get('spotify_error') !== 'access_denied') {
    notifyConnectFailed();
  }
  return connected;
};

/**
 * Starts the "Connect Spotify" OAuth flow.
 *
 * - Native opens the authorize URL in an in-app browser session; the
 *   backend's `/spotify/callback` 302s to the app's universal-link return
 *   URL with the outcome in query params.
 * - Web is a full-page navigation (same reasoning as the Apple web
 *   sign-in): the backend 302s back to the SPA root, and the outcome is
 *   picked up on the next page load via `showPendingSpotifyConnectToast()`.
 */
const connectSpotify = async (): Promise<void> => {
  const response = await japi<PostSpotifyAuthorizeResponse>(
    'post',
    '/spotify/authorize',
    { redirect_target: Platform.OS === 'web' ? 'web' : 'app' },
  );

  const authorizeUrl = response.json?.authorize_url;
  if (!response.ok || !authorizeUrl) {
    notifyConnectFailed();
    return;
  }

  if (Platform.OS === 'web') {
    // The page is navigating away, so this only settles when the user backs
    // out of the consent screen and the browser restores this page from the
    // back/forward cache, which fires `pageshow`.
    return new Promise<void>((resolve) => {
      window.addEventListener('pageshow', () => resolve(), { once: true });
      window.location.assign(authorizeUrl);
    });
  }

  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(
      authorizeUrl,
      `https://${DEEP_LINK_HOSTNAME}/`,
    );
  } catch {
    notifyConnectFailed();
    return;
  }

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return;
  }
  if (result.type !== 'success') {
    notifyConnectFailed();
    return;
  }

  if (consumeReturnParams(parseQueryParams(result.url))) {
    await refreshProfileInfo();
  }
};

/**
 * On web, completes the connect flow started by `connectSpotify()`. Called
 * from the app root once the toast host is mounted, so the outcome isn't
 * lost when the user doesn't visit the profile tab after the redirect back.
 * `/profile-info` is fetched fresh on mount anyway, so no refetch is needed.
 */
const showPendingSpotifyConnectToast = (): void => {
  const params = takeWebReturnParams(['spotify', 'spotify_error']);
  if (params) {
    consumeReturnParams(params);
  }
};

const disconnectSpotify = async (): Promise<void> => {
  const response = await japi('post', '/disconnect-spotify');
  if (!response.ok) {
    notifyError('Couldn’t disconnect Spotify. Try again later.');
    return;
  }
  patchProfileInfo({ spotify_artists: [], spotify_connected: false });
};

export {
  connectSpotify,
  disconnectSpotify,
  showPendingSpotifyConnectToast,
};
