import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { View } from 'react-native';

import { notify } from '../events/events';
import { EV_CLOCK_TICK, useTimeSinceLabel } from './clock';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

const MINUTE_MS = 60 * 1000;

const minutesSince = (elapsedMs: number) =>
  `${Math.max(1, Math.floor(elapsedMs / MINUTE_MS))}m`;

type Renderer = {
  unmount: () => void
  update: (element: React.ReactElement) => void
};

const Label = ({
  at,
  onRender,
}: {
  at: number,
  onRender: (label: string) => void,
}) => {
  onRender(useTimeSinceLabel(at, minutesSince));

  return <View />;
};

const render = (element: React.ReactElement): Renderer => {
  let renderer: Renderer | undefined;

  act(() => { renderer = create(element); });

  if (renderer === undefined) {
    throw new Error('The element failed to render');
  }

  return renderer;
};

const passTime = (ms: number) => act(() => {
  jest.setSystemTime(Date.now() + ms);
  notify(EV_CLOCK_TICK);
});

describe('useTimeSinceLabel', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('labels the time elapsed since `at`', () => {
    const labels: string[] = [];

    const renderer = render(
      <Label at={-5 * MINUTE_MS} onRender={(l) => { labels.push(l); }} />);

    expect(labels.at(-1)).toBe('5m');

    act(() => { renderer.unmount(); });
  });

  test('relabels as time passes', () => {
    const labels: string[] = [];

    const renderer = render(
      <Label at={0} onRender={(l) => { labels.push(l); }} />);

    expect(labels.at(-1)).toBe('1m');

    passTime(2 * MINUTE_MS);
    expect(labels.at(-1)).toBe('2m');

    passTime(MINUTE_MS);
    expect(labels.at(-1)).toBe('3m');

    act(() => { renderer.unmount(); });
  });

  test('relabels immediately when `at` changes', () => {
    const labels: string[] = [];
    const onRender = (l: string) => { labels.push(l); };

    const renderer = render(<Label at={-2 * MINUTE_MS} onRender={onRender} />);

    expect(labels.at(-1)).toBe('2m');

    act(() => {
      renderer.update(<Label at={-9 * MINUTE_MS} onRender={onRender} />);
    });

    expect(labels.at(-1)).toBe('9m');

    act(() => { renderer.unmount(); });
  });

  test('does not re-render while the label is unchanged', () => {
    let renders = 0;

    const renderer = render(
      <Label at={0} onRender={() => { renders += 1; }} />);

    const rendersOnMount = renders;

    passTime(30 * 1000);
    expect(renders).toBe(rendersOnMount);

    passTime(30 * 1000);
    expect(renders).toBe(rendersOnMount);

    passTime(MINUTE_MS);
    expect(renders).toBe(rendersOnMount + 1);

    act(() => { renderer.unmount(); });
  });

  test('stops relabelling once unmounted', () => {
    const labels: string[] = [];

    const renderer = render(
      <Label at={0} onRender={(l) => { labels.push(l); }} />);

    act(() => { renderer.unmount(); });

    const labelsOnUnmount = labels.length;

    passTime(10 * MINUTE_MS);

    expect(labels.length).toBe(labelsOnUnmount);
  });
});
