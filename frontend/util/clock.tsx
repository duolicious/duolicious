import { DependencyList } from 'react';
import { notify, useDerivedEvent } from '../events/events';

const TICK_INTERVAL_MS = 30 * 1000;

const EV_CLOCK_TICK = 'clock-tick';

setInterval(() => notify(EV_CLOCK_TICK), TICK_INTERVAL_MS);

// The tick is a signal to recompute, not a value: `derive` reads the clock
// itself, so a component mounting between ticks isn't stuck with a stale now.
const useOnClockTick = <T,>(derive: () => T, deps: DependencyList): T =>
  useDerivedEvent<void, T>(EV_CLOCK_TICK, derive, deps);

const useTimeSinceLabel = (
  at: number,
  format: (elapsedMs: number) => string,
): string =>
  useOnClockTick(() => format(Date.now() - at), [at, format]);

export {
  EV_CLOCK_TICK,
  useTimeSinceLabel,
};
