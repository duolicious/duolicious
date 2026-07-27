import { ExpoConfig } from 'expo/config';

// In SDK 46 and lower, use the following import instead:
// import { ExpoConfig } from '@expo/config-types';

const DEEP_LINK_HOSTNAME = 'get.duolicious.app';

const config: ExpoConfig = {
  name: 'Duolicious',
  slug: 'duolicious',
  // Registers an intent filter for `app.duolicious://` so Android can
  // dispatch the Google OAuth redirect (`app.duolicious:/oauthredirect`)
  // back into the app. expo-auth-session's Google provider derives the
  // redirect URI from the package name, so the scheme must match.
  scheme: 'app.duolicious',
  version: "32.9.1",
  orientation: "portrait",
  icon: './assets/icon.png',
  updates: {
    fallbackToCacheTimeout: 0
  },
  assetBundlePatterns: [
    "**/*"
  ],
  androidNavigationBar: {
    barStyle: "dark-content",
    backgroundColor: '#ffffff'
  },
  extra: {
    eas: {
      projectId: "a756e088-c07a-4034-b9c5-51f50139ac21"
    },
    apiUrl: process.env.DUO_API_URL,
    chatUrl: process.env.DUO_CHAT_URL,
    imagesUrl: process.env.DUO_IMAGES_URL,
    audioUrl: process.env.DUO_AUDIO_URL,
    statusUrl: process.env.DUO_STATUS_URL,
    inviteUrl: process.env.DUO_INVITE_URL,
    partnerUrl: process.env.DUO_PARTNER_URL,
    webVersion: process.env.DUO_WEB_VERSION,
    klipyApiKey: process.env.DUO_KLIPY_API_KEY,
    notificationIconUrl: process.env.NOTIFICATION_ICON_URL,
    notificationSoundUrl: process.env.NOTIFICATION_SOUND_URL,
    webPushVapidPublicKey: process.env.DUO_WEB_PUSH_VAPID_PUBLIC_KEY,
    googleIosClientId: process.env.DUO_GOOGLE_IOS_CLIENT_ID,
    googleAndroidClientId: process.env.DUO_GOOGLE_ANDROID_CLIENT_ID,
    googleWebClientId: process.env.DUO_GOOGLE_WEB_CLIENT_ID,
    appleWebClientId: process.env.DUO_APPLE_WEB_CLIENT_ID,
    appleRedirectUri: process.env.DUO_APPLE_REDIRECT_URI,
    appleAndroidReturnUrl: process.env.DUO_APPLE_ANDROID_RETURN_URL,
    deepLinkHostname: DEEP_LINK_HOSTNAME,
  },
  web: {
    favicon: "./assets/favicon.png"
  },
  ios: {
    bundleIdentifier: "app.duolicious",
    supportsTablet: false,
    // App Store Guideline 4.8 requires Sign In with Apple alongside any
    // other third-party sign-in option. The capability is added by the
    // expo-apple-authentication plugin below.
    usesAppleSignIn: true,
    associatedDomains: [`applinks:${DEEP_LINK_HOSTNAME}`],
    appStoreUrl: "https://apps.apple.com/us/app/duolicious-dating-app/id6499066647",
    infoPlist: {
      NSMicrophoneUsageDescription: "This app uses the microphone to capture audio for updating and sharing on your profile.",
      NSCameraUsageDescription: "This app uses the camera to capture images for verifying your profile.",
      ITSAppUsesNonExemptEncryption: false
    },
  },
  android: {
    googleServicesFile: "./google-services.json",
    package: "app.duolicious",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#7700ff"
    },
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [
          {
            scheme: "https",
            host: DEEP_LINK_HOSTNAME
          }
        ],
        category: ["BROWSABLE", "DEFAULT"]
      }
    ],
    playStoreUrl: "https://play.google.com/store/apps/details?id=app.duolicious",
    blockedPermissions: [
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
    ],
  },
  plugins: [
    "expo-apple-authentication",
    "expo-image-picker",
    "expo-secure-store",
    [
      "expo-notifications",
      {
        "icon": "./assets/notification.png",
        "color": "#7700ff",
        "sounds": [
          "./assets/audio/notification.mp3"
        ]
      }
    ],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#7700ff",
        image: "./assets/splash.png",
        imageWidth: 300,
      }
    ],
    "expo-image",
    "expo-web-browser",
    "expo-asset",
    [
      "expo-audio",
      {
        enableBackgroundPlayback: false,
      }
    ],
  ],
};

export default config;
