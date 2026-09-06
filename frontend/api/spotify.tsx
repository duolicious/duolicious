import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { japi } from './api';
import {
  navigateAway,
  parseQueryParams,
  takeWebReturnParams,
} from './oauth-return';
import { notify } from '../events/events';
import { DefaultText } from '../components/default-text';
import { SpotifyIcon } from '../components/spotify-artists';
import { ToastContainer, ValidationErrorToast } from '../components/toast';
import { useAppTheme } from '../app-theme/app-theme';
import { patchProfileInfo, refreshProfileInfo } from '../events/profile-info';

type SpotifyArtistItem = {
  spotify_id: string,
  name: string,
  image_url: string | null,
};

type PostSpotifyAuthorizeResponse = {
  authorize_url: string
};

const notifyError = (error: string) =>
  notify<React.FC>('toast', () => <ValidationErrorToast error={error} />);

const notifyConnectFailed = () =>
  notifyError('Couldn’t connect Spotify. Try again later.');

const ConnectedToast = () => {
  const { appTheme } = useAppTheme();

  return (
    <ToastContainer>
      <SpotifyIcon size={24} color={appTheme.secondaryColor} />
      <DefaultText style={{ color: appTheme.secondaryColor, fontWeight: '700' }}>
        Spotify connected
      </DefaultText>
    </ToastContainer>
  );
};

const reportConnectResult = (params: URLSearchParams): boolean => {
  const connected = params.get('spotify') === 'connected';
  if (connected) {
    notify<React.FC>('toast', ConnectedToast);
  } else if (params.get('spotify_error') !== 'access_denied') {
    notifyConnectFailed();
  }
  return connected;
};

const connectSpotify = async (): Promise<void> => {
  const response = await japi<PostSpotifyAuthorizeResponse>(
    'post',
    '/spotify/authorize',
    { redirect_target: Platform.OS === 'web' ? 'web' : 'app' },
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
    notifyError('Couldn’t disconnect Spotify. Try again later.');
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
