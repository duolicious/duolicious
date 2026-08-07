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
// It works because the two domains are the same site (registrable
// domain duolicious.app), so browsers don't partition the iframe's
// storage. The handed-over token is treated as untrusted: startup runs
// it through the ordinary /check-session-token validation, and a dead
// or bogus token just lands on the welcome screen.
//
// A definitive answer (including "no session there") is recorded in
// kv-storage so each browser only ever pays for the bridge once; a
// timeout isn't recorded, so transient failures retry on the next load.
//
// The whole mechanism is a migration aid: once web.duolicious.app
// traffic dwindles, delete this module, its single call site in
// app-startup, public/assets/session-bridge.html, and the _headers
// carve-out in frontend-publish.yml.

const BRIDGE_ORIGIN = 'https://web.duolicious.app';
const BRIDGE_URL = `${BRIDGE_ORIGIN}/assets/session-bridge`;
const BRIDGE_TIMEOUT_MS = 2000;

// The session keys gate the transfer and are adopted explicitly by
// `adoptWebSession`; the bridge bookkeeping key must reflect this
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

const parseBridgedSession = (data: unknown): BridgedSession | null => {
  if (!isRecord(data)) return null;
  const values = data.storage;
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
      finish(parseBridgedSession(event.data), true);
    };

    const timer = setTimeout(() => finish(null, false), BRIDGE_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    iframe.src = BRIDGE_URL;
    document.body.appendChild(iframe);
  });

const adoptWebSessionOnApex = async (): Promise<void> => {
  if (Platform.OS !== 'web') return;
  if (window.location.hostname !== 'duolicious.app') return;
  if (await storeKv('session_token') && await storeKv('person_uuid')) return;
  if (await storeKv('web_session_bridge_answered')) return;

  const bridged = await runBridge();
  if (!bridged) return;

  await storeKv('session_token', bridged.sessionToken);
  await storeKv('person_uuid', bridged.personUuid);
  for (const key of KEYS) {
    const value = bridged.extras[key];
    if (value !== undefined) {
      await storeKv(key, value);
    }
  }
};

export {
  adoptWebSessionOnApex,
};
