/* eslint-disable  @typescript-eslint/no-explicit-any */

type Listener<T = any> = (data?: T) => void;

type ListenersWithLastEvent<T = any> = {
  listeners: Set<Listener<T>>
  lastEvent: T | undefined
};

type eventKeyToListenerWithLastEvent = {
  [key: string]: ListenersWithLastEvent
};

const listeners: eventKeyToListenerWithLastEvent = {};

const listen = <T = any>(
  key: string,
  listener: Listener<T>,
  notifyOnBind: boolean = false,
) => {
  // Ensure `listeners[key]` is set
  listeners[key] = listeners[key] ?? {
    listeners: new Set<Listener<T>>,
    lastEvent: undefined,
  };

  listeners[key].listeners.add(listener);

  // Notify new listener of last event
  const lastEvent = listeners[key].lastEvent;
  if (notifyOnBind && lastEvent !== undefined) {
    listener(lastEvent);
  }

  return () => unlisten(key, listener);
};

const lastEvent = <T = any>(
  key: string,
): T | undefined => {
  // Ensure `listeners[key]` is set
  listeners[key] = listeners[key] ?? {
    listeners: new Set<Listener<T>>,
    lastEvent: undefined,
  };

  // Return last event
  return listeners[key].lastEvent;
};

const unlisten = (key: string, listener: Listener) => {
  listeners[key].listeners.delete(listener);
};

// Resolves with the next value published for `key`, or `undefined` if
// `timeoutMs` elapses first. A one-shot `listen` for code that needs to await
// a single event rather than subscribe to a stream of them.
const nextEvent = <T = any>(
  key: string,
  timeoutMs: number,
): Promise<T | undefined> =>
  new Promise((resolve) => {
    let unlistener = () => {};

    const done = (value?: T) => {
      clearTimeout(timer);
      unlistener();
      resolve(value);
    };

    const timer = setTimeout(() => done(undefined), Math.max(0, timeoutMs));

    unlistener = listen<T>(key, (value) => done(value));
  });

const notify = <T = any>(key: string, data?: T) => {
  // Ensure `listeners[key]` is set
  listeners[key] = listeners[key] ?? {
    listeners: new Set<Listener<T>>,
    lastEvent: undefined,
  };

  listeners[key].lastEvent = data;

  listeners[key].listeners.forEach(
    (listener: Listener) => listener(data)
  );
};

export {
  lastEvent,
  listen,
  nextEvent,
  notify,
  unlisten,
};
