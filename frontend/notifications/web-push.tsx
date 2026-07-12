/**
 * Web Push opt-in for the web app. On authentication `requestAndRegisterWebPush`
 * asks for notification permission (the first time) and registers the browser's
 * push subscription with the backend, re-registering on every reconnect so a
 * rotated endpoint stays current. `useWebPushMessageListenerOnWeb` bridges the
 * service worker back to the app: a `notification-click` routes to a screen, a
 * `resubscribe-web-push` re-subscribes without prompting. Requires the VAPID
 * public key in `WEB_PUSH_VAPID_PUBLIC_KEY`; without it, subscription is a no-op.
 */
import { Platform } from 'react-native';
import { useEffect, useRef } from 'react';
import {
  NOTIFICATION_ICON_URL,
  WEB_PUSH_VAPID_PUBLIC_KEY,
} from '../env/env';
import { registerWebPushSubscription } from '../chat/application-layer';
import { notifyOnWeb } from './web';

const SERVICE_WORKER_URL = '/service-worker.js';

const isWebPushSupported = (): boolean =>
  Platform.OS === 'web' &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  typeof window !== 'undefined' &&
  'PushManager' in window &&
  'Notification' in window;

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
};

const getRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  try {
    await navigator.serviceWorker.register(SERVICE_WORKER_URL);
    return await navigator.serviceWorker.ready;
  } catch (e) {
    console.warn('Failed to register service worker', e);
    return null;
  }
};

const subscribeAndRegister = async (): Promise<boolean> => {
  if (!WEB_PUSH_VAPID_PUBLIC_KEY) {
    console.warn('No VAPID public key configured; web push disabled');
    return false;
  }

  const registration = await getRegistration();
  if (!registration) {
    return false;
  }

  try {
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey:
        urlBase64ToUint8Array(WEB_PUSH_VAPID_PUBLIC_KEY) as BufferSource,
    });

    await registerWebPushSubscription(JSON.stringify(subscription.toJSON()));
    return true;
  } catch (e) {
    console.warn('Failed to subscribe to web push', e);
    return false;
  }
};

const requestAndRegisterWebPush = async (): Promise<void> => {
  if (!isWebPushSupported()) {
    return;
  }

  const alreadyGranted = Notification.permission === 'granted';

  const permission = alreadyGranted
    ? 'granted'
    : await Notification.requestPermission();

  if (permission !== 'granted') {
    return;
  }

  const subscribed = await subscribeAndRegister();

  if (subscribed && !alreadyGranted) {
    notifyOnWeb(
      'Duolicious',
      'Here’s what a message will look like 💜',
      true,
    );
  }
};

const refreshWebPushSubscription = async (): Promise<void> => {
  if (!isWebPushSupported()) {
    return;
  }

  if (Notification.permission !== 'granted') {
    return;
  }

  await subscribeAndRegister();
};

const useWebPushMessageListenerOnWeb = (
  navigate: (screen: string, params: Record<string, unknown>) => void,
) => {
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    if (Platform.OS !== 'web' || !isWebPushSupported()) {
      return;
    }

    const onMessage = (event: MessageEvent) => {
      const message = event.data;

      if (message?.type === 'resubscribe-web-push') {
        refreshWebPushSubscription();
        return;
      }

      if (message?.type !== 'notification-click') {
        return;
      }

      const screen = message.data?.screen as string | undefined;
      const params = message.data?.params as Record<string, unknown> | undefined;

      if (screen) {
        navigateRef.current(screen, params ?? {});
      }
    };

    navigator.serviceWorker.addEventListener('message', onMessage);

    navigator.serviceWorker.ready.then((registration) => {
      registration.active?.postMessage({
        type: 'client-ready',
        iconUrl: NOTIFICATION_ICON_URL,
      });
    });

    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);
};

export {
  requestAndRegisterWebPush,
  useWebPushMessageListenerOnWeb,
};
