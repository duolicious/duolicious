import Constants from 'expo-constants';


export const DEEP_LINK_HOSTNAME: string =
  Constants.expoConfig?.extra?.deepLinkHostname
  ?? 'get.duolicious.app';

export const API_URL = Constants.expoConfig?.extra?.apiUrl
  ?? 'http://localhost:5000';

export const CHAT_URL = Constants.expoConfig?.extra?.chatUrl
  ?? 'ws://localhost:5000/chat';

export const IMAGES_URL = Constants.expoConfig?.extra?.imagesUrl
  ?? 'http://localhost:9090/s3-mock-bucket';

export const AUDIO_URL = Constants.expoConfig?.extra?.audioUrl
  ?? 'http://localhost:9090/s3-mock-audio-bucket';

export const STATUS_URL = Constants.expoConfig?.extra?.statusUrl
  ?? 'http://localhost:8080';

export const INVITE_URL = Constants.expoConfig?.extra?.inviteUrl
  ?? 'https://duolicious.gg';

export const PARTNER_URL = Constants.expoConfig?.extra?.partnerUrl
  ?? 'https://partner.duolicious.app'

export const WEB_VERSION = Constants.expoConfig?.extra?.webVersion
  ?? '000000';

export const TENOR_API_KEY = Constants.expoConfig?.extra?.tenorApiKey
  ?? 'LIVDSRZULELA';

export const NOTIFICATION_ICON_URL = Constants.expoConfig?.extra?.notificationIconUrl
  ?? 'https://duolicious.app/assets/desktop-notification.png';

export const NOTIFICATION_SOUND_URL = Constants.expoConfig?.extra?.notificationSoundUrl
  ?? 'https://duolicious.app/assets/desktop-notification.wav';

// OAuth client IDs for Google Sign-In. Each platform gets a different ID
// from Google Cloud Console; the web ID is also used as the audience the
// backend verifies against during native flows.
//
// All five social-auth env vars below are required at build time. We
// fall back to '' rather than `undefined` so consumers don't need
// null-guards — a missing build-time value will surface as a malformed
// OAuth request from Google/Apple, which is the correct "fail loudly"
// behavior for a misconfigured build.
export const GOOGLE_IOS_CLIENT_ID: string =
  Constants.expoConfig?.extra?.googleIosClientId ??
  '';
export const GOOGLE_ANDROID_CLIENT_ID: string =
  Constants.expoConfig?.extra?.googleAndroidClientId ??
  '';
export const GOOGLE_WEB_CLIENT_ID: string =
  Constants.expoConfig?.extra?.googleWebClientId ??
  '443037492722-n1lcbdqe2u49ev56b1tv6m087a9muhsd.apps.googleusercontent.com';

// Apple Services ID (e.g. `app.duolicious.web`) used as `client_id` for
// the web/Android Sign In with Apple OAuth flow. Distinct from the iOS
// bundle ID, which the native flow uses automatically; this one has to
// be registered separately in the Apple Developer portal with a
// verified domain and a Return URL.
export const APPLE_WEB_CLIENT_ID: string =
  Constants.expoConfig?.extra?.appleWebClientId ??
  'app.duolicious.web';

// The Apple `redirect_uri`. Must match the Return URL configured on the
// Services ID *exactly*. Points at the backend's
// `/auth/apple/callback`, which 302s the user back to the SPA / native
// app with the id_token in a query parameter.
export const APPLE_REDIRECT_URI: string =
  Constants.expoConfig?.extra?.appleRedirectUri ??
  'https://api.duolicious.app/auth/apple/callback';

// The Universal Link / App Link the Android client passes to
// expo-web-browser as `returnUrl`. The backend's Apple callback 302s
// the user here once Apple has POSTed the id_token. Must match the
// backend's `DUO_APPLE_ANDROID_REDIRECT_URL` env var.
export const APPLE_ANDROID_RETURN_URL: string =
  Constants.expoConfig?.extra?.appleAndroidReturnUrl ??
  `https://${DEEP_LINK_HOSTNAME}/`;
