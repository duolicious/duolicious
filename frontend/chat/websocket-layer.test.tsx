import { jest } from '@jest/globals';
import { AppState, AppStateStatus, Platform } from 'react-native';

// React Native stops dispatching JS timers while the app is backgrounded, so
// the connection has to be closed synchronously from the app-state handler.
// These tests pin that down: they never advance timers before asserting that
// the socket was closed, which is exactly what a deferred close would need.

type ChangeHandler = (state: AppStateStatus) => void;

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;

  readyState = 0;
  closeCalls = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.closeCalls++;
    this.readyState = 2;
  }

  send(): void {}
}

const defineProperty = (target: object, key: string, value: unknown): void => {
  Object.defineProperty(target, key, { configurable: true, value });
};

describe('chat websocket app-state handling', () => {
  let changeHandlers: ChangeHandler[] = [];

  const setAppState = (state: AppStateStatus): void => {
    defineProperty(AppState, 'currentState', state);
    changeHandlers.forEach((handler) => handler(state));
  };

  const currentSocket = (): FakeWebSocket => {
    const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
    if (!socket) {
      throw new Error('No websocket was created');
    }
    return socket;
  };

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();

    FakeWebSocket.instances = [];
    changeHandlers = [];

    Object.assign(globalThis, { WebSocket: FakeWebSocket });

    defineProperty(Platform, 'OS', 'android');
    defineProperty(AppState, 'currentState', 'active');

    jest.spyOn(AppState, 'addEventListener').mockImplementation(
      (type, handler) => {
        if (type === 'change') {
          changeHandlers.push(handler);
        }
        return { remove: () => {} };
      }
    );

    // The module connects and registers its app-state listener on import, so
    // it has to be required after the mocks above are in place. `require` is
    // deliberate: `jest.resetModules()` operates on the CommonJS cache, which
    // a hoisted `import` would bypass.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('./websocket-layer');
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('closes the connection as soon as the app is backgrounded', () => {
    const socket = currentSocket();

    setAppState('background');

    expect(socket.closeCalls).toBe(1);
  });

  test('keeps the connection through a transient inactive state', () => {
    const socket = currentSocket();

    setAppState('inactive');
    jest.advanceTimersByTime(6000);

    expect(socket.closeCalls).toBe(0);
  });

  test('does not reconnect while the app stays backgrounded', () => {
    setAppState('background');
    jest.advanceTimersByTime(6000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  test('reconnects when the app becomes active again', () => {
    setAppState('background');
    setAppState('active');

    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});
