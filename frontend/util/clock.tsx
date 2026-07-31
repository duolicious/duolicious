import { DependencyList, useEffect } from 'react';
import { notify, useDerivedEvent } from '../events/events';

const TICK_INTERVAL_MS = 30 * 1000;

const EV_CLOCK_TICK = 'clock-tick';

let ticker: ReturnType<typeof setInterval> | null = null;

// Started lazily rather than at import time: imports run before a test can
// install fake timers, so a module-level interval would be real and keep the
// test process from exiting.
const startTicking = () => {
  if (ticker === null) {
    ticker = setInterval(() => notify(EV_CLOCK_TICK), TICK_INTERVAL_MS);
  }
};

// The tick is a signal to recompute, not a value: `derive` reads the clock
// itself, so a component mounting between ticks isn't stuck with a stale now.
const useOnClockTick = <T,>(derive: () => T, deps: DependencyList): T => {
  useEffect(startTicking, []);

  return useDerivedEvent<void, T>(EV_CLOCK_TICK, derive, deps);
};

const useTimeSinceLabel = (
  at: number,
  format: (elapsedMs: number) => string,
): string =>
  useOnClockTick(() => format(Date.now() - at), [at, format]);

export {
  EV_CLOCK_TICK,
  useTimeSinceLabel,
};
