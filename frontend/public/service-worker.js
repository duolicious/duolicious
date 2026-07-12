/* eslint-env serviceworker */
/**
 * Web Push service worker for the Duolicious web app.
 *
 * It exists so notifications survive a backgrounded tab: the browser throttles
 * a background tab's JS (so the in-page chat WebSocket can't raise a
 * notification promptly), but the push service still wakes this worker. The
 * server only sends a push to online users, so this worker's job is just to
 * render it -- suppressing it when a tab is focused, since the user is already
 * looking at the app -- and to route a click to the right conversation. When no
 * tab is open, a click stashes the route in `pendingNotificationClick` and a
 * freshly opened page pulls it once it posts `client-ready`, since that page has
 * no message listener attached yet when it first opens. That same `client-ready`
 * message hands over the app's configured notification icon URL, so this worker
 * -- which can't read the app's env -- falls back to the Duolicious default only
 * when a push arrives before any client has connected.
 *
 * This is a plain, unbundled file served from the site root (`public/` is
 * copied to the web export root), so it must not import app code.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

let notificationIconUrl = 'https://duolicious.app/assets/desktop-notification.png';

const anyClientFocused = async () => {
  const clients = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  return clients.some((client) => client.focused);
};

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'Duolicious';
  const body = payload.body || '';
  const data = payload.data || {};

  const tag = data?.params?.personUuid || undefined;

  event.waitUntil((async () => {
    if (await anyClientFocused()) {
      return;
    }

    await self.registration.showNotification(title, {
      body,
      tag,
      icon: notificationIconUrl,
      data,
    });
  })());
});

let pendingNotificationClick = null;

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    const existing = clients[0];
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: 'notification-click', data });
      return;
    }

    pendingNotificationClick = data;
    await self.clients.openWindow('/');
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'client-ready') {
    return;
  }

  if (event.data.iconUrl) {
    notificationIconUrl = event.data.iconUrl;
  }

  if (!pendingNotificationClick) {
    return;
  }

  event.source?.postMessage({
    type: 'notification-click',
    data: pendingNotificationClick,
  });
  pendingNotificationClick = null;
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    for (const client of clients) {
      client.postMessage({ type: 'resubscribe-web-push' });
    }
  })());
});
