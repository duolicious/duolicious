import { Platform } from 'react-native';
import { storeKv } from '../kv-storage/kv-storage';

// Sessions live in origin-scoped localStorage, so users who signed in on
// web.duolicious.app arrive at duolicious.app logged out. This fetches
// their session from the old origin via a hidden iframe of the static
// bridge page (public/assets/session-bridge.html), which posts the
// stored credentials back. It works because the two domains are the same
// site (registrable domain duolicious.app), so browsers don't partition
// the iframe's storage. The handed-over token is treated as untrusted:
// the caller runs it through the ordinary /check-session-token
// validation, and a dead or bogus token just lands on the welcome
// screen.
//
// A definitive answer (including "no session there") is recorded in
// kv-storage so each browser only ever pays for the bridge once; a
// timeout isn't recorded, so transient failures retry on the next load.

const BRIDGE_ORIGIN = 'https://web.duolicious.app';
const BRIDGE_URL = `${BRIDGE_ORIGIN}/assets/session-bridge`;
const BRIDGE_TIMEOUT_MS = 2000;

type BridgedSession = {
  sessionToken: string
  personUuid: string
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
      const data = event.data;
      if (data?.type !== 'session-bridge') return;
      if (typeof data.sessionToken !== 'string') {
        finish(null, true);
        return;
      }
      if (typeof data.personUuid !== 'string') {
        finish(null, true);
        return;
      }
      finish(
        { sessionToken: data.sessionToken, personUuid: data.personUuid },
        true,
      );
    };

    const timer = setTimeout(() => finish(null, false), BRIDGE_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    iframe.src = BRIDGE_URL;
    document.body.appendChild(iframe);
  });

const fetchWebSessionOnApex = async (): Promise<BridgedSession | null> => {
  if (Platform.OS !== 'web') return null;
  if (window.location.hostname !== 'duolicious.app') return null;
  if (await storeKv('web_session_bridge_answered')) return null;

  return await runBridge();
};

export {
  fetchWebSessionOnApex,
};
