import { Platform } from 'react-native';
import { KEYS, Key, storeKv } from './kv-storage';

// Sessions live in origin-scoped localStorage, so users who signed in on
// web.duolicious.app arrive at duolicious.app logged out.
// `adoptWebSessionOnApex`, called once at startup before the session is
// read from kv-storage, fetches their session -- and the rest of the
// app's stored state, like drafts, theme and seen-hints -- from the old
// origin via a hidden iframe of the static bridge page
// (public/assets/session-bridge.html), which posts its entire
// localStorage back; only keys in the kv-storage allowlist are adopted.
// Most browsers don't partition the iframe's storage, because the two
// domains are the same site (registrable domain duolicious.app), but
// Safari does, so there the iframe finds nothing. For Safari,
// web.duolicious.app's "moving" modal runs `goToApex`, which hands the
// session over in a short-lived cookie on the shared domain; the apex
// deletes it as soon as it has read it. Any duolicious.app subdomain can
// set that cookie, so the apex ignores it unless it's the only one and
// the page was reached from web.duolicious.app. Either way, the
// handed-over token is treated as untrusted: startup runs it through the
// ordinary /check-session-token validation, and a dead or bogus token
// just lands on the welcome screen.
//
// A definitive answer (including "no session there") is recorded in
// kv-storage so each browser only ever pays for the bridge once; a
// timeout isn't recorded, so transient failures retry on the next load.
//
// The whole mechanism is a migration aid: once web.duolicious.app
// traffic dwindles, delete this module, its call site in app-startup,
// components/modal/web-app-moving-modal.tsx,
// public/assets/session-bridge.html, and the _headers carve-out in
// frontend-publish.yml.

const BRIDGE_ORIGIN = 'https://web.duolicious.app';
const BRIDGE_URL = `${BRIDGE_ORIGIN}/assets/session-bridge`;
const BRIDGE_TIMEOUT_MS = 2000;
const HANDOFF_COOKIE = '__Secure-session_handoff';

// The session keys gate the transfer and are adopted explicitly by
// `adoptWebSessionOnApex`; the bridge bookkeeping key must reflect this
// origin's own state, never the other origin's.
const UNTRANSFERABLE_KEYS: readonly Key[] = [
  'session_token',
  'person_uuid',
  'web_session_bridge_answered',
];

type BridgedSession = {
  sessionToken: string
  personUuid: string
  extras: Partial<Record<Key, string>>
};

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null;

const parseBridgedSession = (values: unknown): BridgedSession | null => {
  if (!isRecord(values)) return null;

  const sessionToken = values['session_token'];
  const personUuid = values['person_uuid'];
  if (typeof sessionToken !== 'string') return null;
  if (typeof personUuid !== 'string') return null;

  const extras: Partial<Record<Key, string>> = {};
  for (const key of KEYS) {
    if (UNTRANSFERABLE_KEYS.includes(key)) continue;
    const value = values[key];
    if (typeof value === 'string') {
      extras[key] = value;
    }
  }

  return { sessionToken, personUuid, extras };
};

const runBridge = (): Promise<BridgedSession | null> =>
  new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';

    const finish = async (
      result: BridgedSession | null,
      isDefinitive: boolean,
    ) => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      iframe.remove();
      if (isDefinitive) {
        await storeKv('web_session_bridge_answered', '1');
      }
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== BRIDGE_ORIGIN) return;
      if (event.source !== iframe.contentWindow) return;
      if (event.data?.type !== 'session-bridge') return;
      finish(parseBridgedSession(event.data.storage), true);
    };

    const timer = setTimeout(() => finish(null, false), BRIDGE_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    iframe.src = BRIDGE_URL;
    document.body.appendChild(iframe);
  });

const setHandoffCookie = (value: string, maxAgeSeconds: number) => {
  document.cookie =
    `${HANDOFF_COOKIE}=${value}; Domain=duolicious.app; Path=/; ` +
    `Max-Age=${maxAgeSeconds}; Secure; SameSite=Lax`;
};

const takeHandedOverSession = (): BridgedSession | null => {
  const cookies = document.cookie
    .split('; ')
    .filter((c) => c.startsWith(`${HANDOFF_COOKIE}=`));
  if (cookies.length === 0) return null;

  setHandoffCookie('', 0);
  if (cookies.length > 1) return null;
  if (!document.referrer.startsWith(`${BRIDGE_ORIGIN}/`)) return null;
  try {
    return parseBridgedSession(JSON.parse(decodeURIComponent(
      cookies[0].slice(HANDOFF_COOKIE.length + 1))));
  } catch {
    return null;
  }
};

const adoptWebSessionOnApex = async (): Promise<void> => {
  if (Platform.OS !== 'web') return;
  if (window.location.hostname !== 'duolicious.app') return;
  const handedOver = takeHandedOverSession();
  if (await storeKv('session_token') && await storeKv('person_uuid')) return;

  const bridged = await storeKv('web_session_bridge_answered')
    ? null
    : await runBridge();
  const session = bridged ?? handedOver;
  if (!session) return;

  await storeKv('session_token', session.sessionToken);
  await storeKv('person_uuid', session.personUuid);
  for (const key of KEYS) {
    const value = session.extras[key];
    if (value !== undefined) {
      await storeKv(key, value);
    }
  }
};

const goToApex = async (): Promise<void> => {
  const storage = {
    session_token: await storeKv('session_token'),
    person_uuid: await storeKv('person_uuid'),
  };
  setHandoffCookie(encodeURIComponent(JSON.stringify(storage)), 300);

  const url = new URL(window.location.href);
  url.host = 'duolicious.app';
  window.location.replace(url.href);
};

export {
  adoptWebSessionOnApex,
  goToApex,
};
