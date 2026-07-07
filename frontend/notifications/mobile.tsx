import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

const unpackNotificationResponse = (
  response: Notifications.NotificationResponse | null,
) => {
  if (!response) {
    return null;
  }

  const data = response.notification.request.content.data;
  const screen = data?.screen as string;
  const params = data?.params as Record<string, unknown>;

  return { screen, params };
}

const useNotificationObserverOnMobile = (
  func: (screen: string, params: Record<string, unknown>) => void,
  deps?: React.DependencyList | undefined,
) => {
  if (Platform.OS === 'web') {
    return;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const subscription = Notifications
      .addNotificationResponseReceivedListener(response => {
        const notification = unpackNotificationResponse(response);

        if (notification) {
          func(notification.screen, notification.params);
        }
      });

    return () => subscription.remove();
  }, deps);
};

const dismissConversationNotificationsOnMobile = async (
  personUuid: string,
) => {
  if (Platform.OS === 'web') {
    return;
  }

  const notifications = await Notifications.getPresentedNotificationsAsync();

  await Promise.all(
    notifications
      .filter(notification => {
        const data = notification.request.content.data;
        const params = data?.params as Record<string, unknown> | undefined;

        return (
          data?.screen === 'Conversation Screen' &&
          params?.personUuid === personUuid
        );
      })
      .map(notification =>
        Notifications.dismissNotificationAsync(notification.request.identifier)
      )
  );
};

// The server zeroes its unseen-notification counter when a client connects,
// but the badge already on this device's app icon only updates when the next
// push arrives, so clear it locally the moment the app is opened or
// foregrounded.
const useClearAppIconBadgeOnMobile = () => {
  if (Platform.OS === 'web') {
    return;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    Notifications.setBadgeCountAsync(0);

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        Notifications.setBadgeCountAsync(0);
      }
    });

    return () => subscription.remove();
  }, []);
};

const getLastNotificationResponseOnMobile = async () => {
  if (Platform.OS === 'web') {
    return null;
  }

  const notification = await Notifications.getLastNotificationResponseAsync();

  return unpackNotificationResponse(notification);
};

export {
  dismissConversationNotificationsOnMobile,
  getLastNotificationResponseOnMobile,
  useClearAppIconBadgeOnMobile,
  useNotificationObserverOnMobile,
};
