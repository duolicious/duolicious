/* eslint-disable  @typescript-eslint/no-explicit-any */

import { useLayoutEffect, useRef, useState } from 'react';
import type { DependencyList } from 'react';

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

// Subscribes to `key`, re-rendering only when the value `derive`d from the
// event changes. The change check matters: calling a state setter even with
// an unchanged value isn't free, as React can still render the component once
// before bailing out. `deps` are the values `derive` closes over.
const useDerivedEvent = <T, U>(
  key: string,
  derive: (e: T | undefined) => U,
  deps: DependencyList,
): U => {
  const [value, setValue] = useState<U>(() => derive(lastEvent<T>(key)));

  const valueRef = useRef(value);

  useLayoutEffect(() => {
    const update = (e: T | undefined) => {
      const next = derive(e);
      if (next === valueRef.current) return;
      valueRef.current = next;
      setValue(next);
    };

    update(lastEvent<T>(key));

    return listen<T>(key, update);
  }, [key, ...deps]);

  return value;
};

export {
  lastEvent,
  listen,
  nextEvent,
  notify,
  unlisten,
  useDerivedEvent,
};
