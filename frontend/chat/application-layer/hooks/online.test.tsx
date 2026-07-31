import { jest } from '@jest/globals';
import { View } from 'react-native';

jest.useFakeTimers();
jest.mock('../../websocket-layer', () => ({
  send: jest.fn(),
  EV_CHAT_WS_RECEIVE: 'chat-ws-receive',
}));

const DAY_MS = 24 * 60 * 60 * 1000;

type Presence = { status: string };

type Renderer = { unmount: () => void };

// `jest.resetModules()` hands the module under test a fresh React, so the
// renderer has to be required from that same fresh registry to share it.
let act: (body: () => void) => void;
let create: (element: React.ReactElement) => Renderer;
let useOnline: (personUuid: string | null | undefined) => Presence;
let notify: (key: string, data?: unknown) => void;

const Probe = ({
  personUuid,
  onRender,
}: {
  personUuid: string,
  onRender: (presence: Presence) => void,
}) => {
  onRender(useOnline(personUuid));

  return <View />;
};

const onlineEvent = (status: string, secondsAgo?: string) => ({
  duo_online_event: {
    '@uuid': 'person1',
    '@status': status,
    ...(secondsAgo === undefined ? { } : { '@seconds_ago': secondsAgo }),
  },
});

describe('Batching Mechanism and Reference Counting', () => {
  let subscribe: (personUuid: string) => () => void;
  let send: jest.Mock;

  beforeEach(() => {
    // Reset modules and import a fresh instance. `jest.resetModules()`
    // operates on the CommonJS require cache, so we deliberately use
    // `require` here rather than ES `import` (which is hoisted and
    // wouldn't pick up the reset module instance).
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const online = require('./online');
    subscribe = online.subscribe;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    send = require('../../websocket-layer').send;
    jest.clearAllTimers();
  });

  test('should send subscribe event after 200ms for a single subscribe', () => {
    subscribe('person1');
    // Before the batch window expires, no event should be sent.
    expect(send).not.toHaveBeenCalled();

    // Fast-forward 200ms to trigger the flush.
    jest.advanceTimersByTime(200);

    // We expect a single subscribe event.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      data: { duo_subscribe_online: { '@uuid': 'person1' } },
    });
  });

  test('should not send any event if subscribe and unsubscribe cancel out', () => {
    const unsubscribe = subscribe('person1');
    unsubscribe();

    // Flush the batch.
    jest.advanceTimersByTime(200);

    // Since subscribe and unsubscribe cancel each other, no event should be sent.
    expect(send).not.toHaveBeenCalled();
  });

  test('should send subscribe event only once even with multiple subscribes in a batch', () => {
    subscribe('person1');
    subscribe('person1');

    jest.advanceTimersByTime(200);

    // Even though subscribe was called twice, only one subscribe event is sent.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      data: { duo_subscribe_online: { '@uuid': 'person1' } },
    });
  });

  test('should send unsubscribe event when unsubscribing crosses from positive to 0', () => {
    const unsubscribe = subscribe('person1');

    // Trigger subscribe event.
    jest.advanceTimersByTime(200);
    expect(send).toHaveBeenCalledTimes(1);

    unsubscribe();
    jest.advanceTimersByTime(200);

    // Now an unsubscribe event should be sent.
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toEqual({
      data: { duo_unsubscribe_online: { '@uuid': 'person1' } },
    });
  });

  test('should combine multiple subscribe/unsubscribe events correctly in one batch', () => {
    const unsubscribe1 = subscribe('person1');
    const unsubscribe2 = subscribe('person1');
    unsubscribe1();
    unsubscribe2();

    jest.advanceTimersByTime(200);

    // All actions cancel out so no event should be sent.
    expect(send).not.toHaveBeenCalled();
  });
});

describe('useOnline', () => {
  let renderer: Renderer;
  let presences: Presence[];

  beforeEach(() => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ act, create } = require('react-test-renderer'));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    useOnline = require('./online').useOnline;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notify = require('../../../events/events').notify;
    jest.clearAllTimers();
    jest.setSystemTime(DAY_MS);

    presences = [];

    act(() => {
      renderer = create(
        <Probe
          personUuid="person1"
          onRender={(presence) => { presences.push(presence); }}
        />
      );
    });

    act(() => { notify('online-subscribable', true); });
  });

  afterEach(() => {
    act(() => { renderer.unmount(); });
  });

  test('reports a sighting as the instant it happened', () => {
    act(() => {
      notify('chat-ws-receive', onlineEvent('online-recently', '60'));
    });

    expect(presences.at(-1)).toEqual({
      status: 'online-recently',
      lastOnlineAt: DAY_MS - 60 * 1000,
    });
  });

  test('renders once per presence change', () => {
    const rendersOnMount = presences.length;

    act(() => {
      notify('chat-ws-receive', onlineEvent('online-recently', '60'));
    });

    expect(presences.length).toBe(rendersOnMount + 1);
  });

  test('does not render when an unchanged presence is republished', () => {
    act(() => { notify('chat-ws-receive', onlineEvent('online')); });

    const rendersOnFirstEvent = presences.length;

    act(() => { notify('chat-ws-receive', onlineEvent('online')); });

    expect(presences.length).toBe(rendersOnFirstEvent);
  });

  test('forgets a sighting once its window has passed, rendering once', () => {
    act(() => {
      notify('chat-ws-receive', onlineEvent('online-recently', '60'));
    });

    const rendersOnEvent = presences.length;

    act(() => { jest.advanceTimersByTime(DAY_MS); });

    expect(presences.at(-1)).toEqual({ status: 'offline' });
    expect(presences.length).toBe(rendersOnEvent + 1);
  });

  test('keeps an ageless sighting, which has no window to fall out of', () => {
    act(() => { notify('chat-ws-receive', onlineEvent('online-recently')); });

    act(() => { jest.advanceTimersByTime(DAY_MS); });

    expect(presences.at(-1)).toEqual({
      status: 'online-recently',
      lastOnlineAt: null,
    });
  });
});
