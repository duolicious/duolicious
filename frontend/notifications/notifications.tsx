import { AppState, Platform } from 'react-native';
import { registerPushToken } from '../chat/application-layer';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useEffect } from 'react';
import { requestAndRegisterWebPush } from './web-push';
import { delay } from '../util/util';

type MaybeToken = { token: string | null } | null;
const expoPushTokenMaxAttempts = 3;
const expoPushTokenInitialRetryDelayMs = 1000;

const refreshWebPushOnWeb = async (): Promise<MaybeToken> => {
  if (Platform.OS !== 'web') {
    return { token: null };
  }

  await requestAndRegisterWebPush();

  return { token: null };
};


const requestPermissionOnMobile = async (): Promise<MaybeToken> => {
  const { status } = await Notifications.getPermissionsAsync();
  const finalStatus =
    status === 'granted' ?
    status :
    (await Notifications.requestPermissionsAsync()).status;

  if (finalStatus !== 'granted') {
    console.error('Failed to get push token for push notification!');
    return null;
  }

  // The setNotificationChannelAsync must be called before
  // getDevicePushTokenAsync or getExpoPushTokenAsync to obtain a push token.
  //
  // SRC: https://docs.expo.dev/versions/latest/sdk/notifications/#permissions

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: AppState.currentState !== 'active',
      shouldShowList: AppState.currentState !== 'active',
      shouldPlaySound: AppState.currentState !== 'active',
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  const token = await getExpoPushToken();
  return token ? { token } : null;
};


// Passing the rolled `devicePushToken` avoids getExpoPushTokenAsync calling
// getDevicePushTokenAsync internally, which would re-trigger the push token
// listener and risk an infinite loop.
const getExpoPushToken = async (
  devicePushToken?: Notifications.DevicePushToken,
): Promise<string | null> => {
  const projectId = Constants.expoConfig?.extra?.eas.projectId;
  const options = devicePushToken ? { projectId, devicePushToken } : { projectId };

  for (let attempt = 1; attempt <= expoPushTokenMaxAttempts; attempt++) {
    try {
      const token = await Notifications.getExpoPushTokenAsync(options);
      return token.data;
    } catch (e) {
      if (attempt === expoPushTokenMaxAttempts) {
        console.warn('Failed to get Expo push token', e);
        return null;
      }

      await delay(expoPushTokenInitialRetryDelayMs * 2 ** (attempt - 1));
    }
  }

  return null;
};


const getAndRegisterPushToken = async (): Promise<void> => {
  const maybeToken = Platform.OS === 'web'
    ? await refreshWebPushOnWeb()
    : await requestPermissionOnMobile();

  if (!maybeToken) {
    return;
  }

  registerPushToken(maybeToken.token);
};


// The push notification service can roll a device's push token while the app is
// running, invalidating the old one. Re-register the fresh Expo push token with
// the backend as soon as that happens.
const usePushTokenListenerOnMobile = () => {
  if (Platform.OS === 'web') {
    return;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const subscription = Notifications.addPushTokenListener(
      async (devicePushToken) => {
        const token = await getExpoPushToken(devicePushToken);
        if (token) {
          registerPushToken(token);
        }
      }
    );

    return () => subscription.remove();
  }, []);
};

export {
  getAndRegisterPushToken,
  usePushTokenListenerOnMobile,
};
