import { CHAT_URL } from '../env/env';
import { lastEvent, listen, notify } from '../events/events';
import {
  delay,
  jsonParseSilently,
  makeBackoff,
} from '../util/util';
import { AppState, AppStateStatus, Platform } from 'react-native';
import {
  EV_NETWORK_CAME_ONLINE,
  EV_NETWORK_IS_ONLINE,
} from '../network/network';

type Pong = {
  preferredInterval: number
  preferredTimeout: number
};

const EV_CHAT_WS_CLOSE = 'chat-ws-close';
const EV_CHAT_WS_OPEN = 'chat-ws-open';
const EV_CHAT_WS_RECEIVE = 'chat-ws-receive';
const EV_CHAT_WS_SEND_CLOSE = 'chat-ws-send-close';

const stableConnectionMs = 10000;
const backgroundedCloseGraceMs = 5000;
const reconnectBackoff = makeBackoff();
let backgroundedCloseTimeout: ReturnType<typeof setTimeout> | undefined;

const pong: Pong = {
  preferredInterval: 10000,
  preferredTimeout: 5000,
};

let lastEnteredActiveState =  new Date();

let ws: WebSocket | null = null;
let expectedClose = false;

const closeChatWebSocket = (): void => {
  if (!ws) {
    return;
  }

  expectedClose = true;
  ws.close();
};

// `close()` only starts the closing handshake. When the network is gone the
// close frame can't be delivered, so Chromium parks the socket in CLOSING for
// up to 60 seconds before `onclose` fires; WebKit fails the socket
// immediately. Dropping the reference right away lets a reconnect proceed
// without waiting for the zombie to time out. The zombie's own callbacks are
// inert thanks to the `ws !== _ws` guards.
const abandonChatWebSocket = (): void => {
  const _ws = ws;

  if (!_ws) {
    return;
  }

  ws = null;
  expectedClose = false;
  _ws.close();
  notify(EV_CHAT_WS_CLOSE);
  setTimeout(connectChatWebSocket, reconnectBackoff.next());
};

listen(EV_CHAT_WS_SEND_CLOSE, closeChatWebSocket);

const isBackgrounded = (state: AppStateStatus): boolean =>
  Platform.OS !== 'web' && ['background', 'inactive'].includes(state);

const isOffline = (): boolean =>
  lastEvent<boolean>(EV_NETWORK_IS_ONLINE) === false;

const connectChatWebSocket = (): void => {
  if (ws) {
    return;
  }

  if (isBackgrounded(AppState.currentState)) {
    return;
  }

  if (isOffline()) {
    return;
  }

  const _ws = new WebSocket(CHAT_URL, ['json']);
  ws = _ws;

  let resetDelayTimeout: ReturnType<typeof setTimeout> | undefined;

  _ws.onopen = () => {
    if (ws !== _ws) {
      return;
    }

    resetDelayTimeout = setTimeout(reconnectBackoff.reset, stableConnectionMs);
    notify(EV_CHAT_WS_OPEN);
  };

  _ws.onmessage = (event: MessageEvent) => {
    if (ws !== _ws) {
      return;
    }

    notify<any>(EV_CHAT_WS_RECEIVE, jsonParseSilently(event.data)); // eslint-disable-line @typescript-eslint/no-explicit-any
  };

  // This seems to get called after the app has been backgrounded for some time.
  // If not, the ping mechanism should still restart the connection, though more
  // slowly.
  _ws.onclose = (event: CloseEvent) => {
    clearTimeout(resetDelayTimeout);

    if (ws !== _ws) {
      return;
    }

    notify<CloseEvent>(EV_CHAT_WS_CLOSE, event);
    ws = null;

    if (expectedClose) {
      expectedClose = false;
      connectChatWebSocket();
    } else {
      setTimeout(connectChatWebSocket, reconnectBackoff.next());
    }
  };

  _ws.onerror = () => {
    _ws.close();
  };
};

type MustIncludeNull<T> = null extends T ? T : never;

type Send = {
  // When only a responseDetector is provided.
  <T>(params: {
    data: object;
    responseDetector: (input: any) => MustIncludeNull<T>; // eslint-disable-line @typescript-eslint/no-explicit-any
    sentinelDetector?: never;
    timeoutMs?: number;
  }): Promise<NonNullable<T> | 'timeout'>;

  // When both responseDetector and sentinelDetector are provided.
  <T>(params: {
    data: object;
    responseDetector: (input: any) => MustIncludeNull<T>; // eslint-disable-line @typescript-eslint/no-explicit-any
    sentinelDetector: (input: any) => boolean; // eslint-disable-line @typescript-eslint/no-explicit-any
    timeoutMs?: number;
  }): Promise<NonNullable<T>[] | 'timeout'>;

  // When neither detector is provided.
  (params: {
    data: object;
    responseDetector?: undefined;
    sentinelDetector?: undefined;
    timeoutMs?: number;
  }): Promise<'timeout' | void>;
}

const send: Send = async <T,>({
  data,
  responseDetector,
  sentinelDetector,
  timeoutMs = 5000,
}: {
  data: object,
  responseDetector?: (input: any) => T | null, // eslint-disable-line @typescript-eslint/no-explicit-any
  sentinelDetector?: (input: any) => boolean, // eslint-disable-line @typescript-eslint/no-explicit-any
  timeoutMs?: number
}) => {
  if (ws?.readyState !== WebSocket.OPEN) {
    return 'timeout';
  }

  return new Promise<T[] | T | 'timeout' | void>((resolve) => {
    const responses: T[] = [];

    const resolveAndCleanup = (
      value:
        | void
        | T[]
        | T
        | "timeout"
    ): void => {
      removeListener();
      resolve(value);
    };

    const responseHandler = (parsed: any): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!responseDetector) {
        return;
      }

      const maybeResponse = responseDetector(parsed);

      if (maybeResponse !== null && sentinelDetector) {
        responses.push(maybeResponse);
      }

      if (maybeResponse !== null && !sentinelDetector) {
        resolveAndCleanup(maybeResponse);
      }
    };

    const sentinelHandler = (parsed: any): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!sentinelDetector) {
        return;
      }

      const maybeSentinel = sentinelDetector(parsed);

      if (maybeSentinel) {
        resolveAndCleanup(responses);
      };
    };

    const removeListener = listen(
      EV_CHAT_WS_RECEIVE,
      (data) => {
        if (data === undefined) {
          return;
        }

        responseHandler(data);
        sentinelHandler(data);
      }
    );

    if (timeoutMs) {
      setTimeout(() => {
        resolveAndCleanup('timeout');
      }, timeoutMs);
    }

    ws?.send(JSON.stringify(data));

    if (!responseDetector && !sentinelDetector) {
      resolveAndCleanup();
    }
  });
};

const pingServer = async () => {
  const data = { duo_ping: null };

  const responseDetector = (doc: any): Pong | null => { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const {
        duo_pong: {
          '@preferred_interval': preferredInterval,
          '@preferred_timeout': preferredTimeout,
        }
      } = doc;

      return { preferredInterval, preferredTimeout };
    } catch {
      return null;
    }
  };

  const requestStartDate = new Date();

  const response = await send({
    data,
    responseDetector,
    timeoutMs: pong.preferredInterval,
  });

  // After the app becomes active from being backgrounded, there's a race
  // between the update of `lastEnteredActiveState` and this comparison logic.
  // Doing the comparison after the `response` is received is a hack so that we
  // use the recently updated value of `lastEnteredActiveState` rather than the
  // stale value, before the app was backgrounded.
  const msSinceEnteredActiveState = (
    requestStartDate.getTime() - lastEnteredActiveState.getTime());

  if (msSinceEnteredActiveState < pong.preferredTimeout) {
    return;
  }

  if (response === 'timeout') {
    // An unresponsive connection would stall the closing handshake too.
    abandonChatWebSocket();
  } else {
    Object.assign(pong, response);
  }
};

const pingServerForever = async () => {
  while (true) {
    await delay(pong.preferredInterval);
    await pingServer();
  };
};

const closeIfStillBackgrounded = (): void => {
  if (isBackgrounded(AppState.currentState)) {
    closeChatWebSocket();
  }
};

const onChangeAppState = (state: AppStateStatus) => {
  if (state === 'active') {
    lastEnteredActiveState = new Date();
    clearTimeout(backgroundedCloseTimeout);
    connectChatWebSocket();
  }

  if (isBackgrounded(state)) {
    clearTimeout(backgroundedCloseTimeout);
    backgroundedCloseTimeout = setTimeout(
      closeIfStillBackgrounded,
      backgroundedCloseGraceMs,
    );
  }
};

// In effect, updates the inbox when resuming from an inactive state by
// detecting if the app went offline
AppState.addEventListener('change', onChangeAppState);

// Desktop browsers don't close websockets when connectivity drops; the socket
// object stays OPEN until a write times out. Abandon it (rather than just
// closing: see `abandonChatWebSocket`) so the came-online reconnect below
// isn't blocked by a socket stuck in CLOSING.
listen<boolean>(EV_NETWORK_IS_ONLINE, (isOnline) => {
  if (isOnline === false) {
    abandonChatWebSocket();
  }
});

listen(EV_NETWORK_CAME_ONLINE, connectChatWebSocket);

connectChatWebSocket();

pingServerForever();

export {
  EV_CHAT_WS_CLOSE,
  EV_CHAT_WS_OPEN,
  EV_CHAT_WS_RECEIVE,
  EV_CHAT_WS_SEND_CLOSE,
  send,
};
