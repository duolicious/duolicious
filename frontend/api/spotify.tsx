import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { japi } from './api';
import {
  navigateAway,
  parseQueryParams,
  takeWebReturnParams,
  webReturnTarget,
} from './oauth-return';
import { SpotifyIcon } from '../components/spotify-artists';
import { notifyErrorToast, notifyIconToast } from '../components/toast';
import { patchProfileInfo, refreshProfileInfo } from '../events/profile-info';

type SpotifyArtistItem = {
  spotify_id: string,
  name: string,
  image_url: string | null,
};

type PostSpotifyAuthorizeResponse = {
  authorize_url: string
};

const notifyConnectFailed = () =>
  notifyErrorToast('Couldn’t connect Spotify. Try again later.');

const reportConnectResult = (params: URLSearchParams): boolean => {
  const connected = params.get('spotify') === 'connected';
  if (connected) {
    notifyIconToast('Spotify connected', (color) =>
      <SpotifyIcon size={24} color={color} />
    );
  } else if (params.get('spotify_error') !== 'access_denied') {
    notifyConnectFailed();
  }
  return connected;
};

const connectSpotify = async (): Promise<void> => {
  const response = await japi<PostSpotifyAuthorizeResponse>(
    'post',
    '/spotify/authorize',
    { redirect_target: Platform.OS === 'web' ? webReturnTarget() : 'app' },
  );

  if (!response.ok || !response.json) {
    notifyConnectFailed();
    return;
  }

  const authorizeUrl = response.json.authorize_url;

  if (Platform.OS === 'web') {
    return navigateAway(authorizeUrl);
  }

  let result: WebBrowser.WebBrowserAuthSessionResult;
  try {
    result = await WebBrowser.openAuthSessionAsync(
      authorizeUrl,
      'app.duolicious://spotify',
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

  if (reportConnectResult(parseQueryParams(result.url))) {
    await refreshProfileInfo();
  }
};

const showPendingSpotifyConnectToast = (): void => {
  const params = takeWebReturnParams(['spotify', 'spotify_error']);
  if (params) {
    reportConnectResult(params);
  }
};

const disconnectSpotify = async (): Promise<void> => {
  const response = await japi('post', '/disconnect-spotify');
  if (!response.ok) {
    notifyErrorToast('Couldn’t disconnect Spotify. Try again later.');
    return;
  }
  patchProfileInfo({ spotify_artists: [], spotify_connected: false });
};

export {
  SpotifyArtistItem,
  connectSpotify,
  disconnectSpotify,
  showPendingSpotifyConnectToast,
};
