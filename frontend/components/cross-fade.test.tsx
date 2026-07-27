import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { useEffect } from 'react';
import { View } from 'react-native';
import { CrossFadeText } from './cross-fade';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

const Label = ({ text, onMount }: { text: string, onMount: () => void }) => {
  useEffect(() => { onMount(); }, []);

  return <View testID={text} />;
};

const opacities = (renderer: {
  root: { findAllByType: (t: unknown) => { props: { style?: unknown } }[] }
}): number[] =>
  renderer.root
    .findAllByType(View)
    .map((node) => {
      const styles = [node.props.style].flat();

      return styles.find(
        (style): style is { opacity: number } =>
          !!style && typeof style === 'object' && 'opacity' in style
      )?.opacity;
    })
    .filter((opacity): opacity is number => opacity !== undefined);

describe('CrossFadeText', () => {
  beforeEach(() => { jest.useFakeTimers(); });

  afterEach(() => { jest.useRealTimers(); });

  test('the only layer is opaque before anything changes', () => {
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = create(
        <CrossFadeText triggerKey="a">
          <Label text="a" onMount={() => {}} />
        </CrossFadeText>
      );
    });

    expect(opacities(renderer!)).toEqual([1]);
  });

  // The incoming layer starts hidden and the outgoing layer starts opaque. The
  // layers are mounted for the transition, so those starting opacities reach
  // the screen with the layers rather than in a commit of their own.
  test('a transition mounts both layers with their starting opacities', () => {
    const mounts: string[] = [];

    const render = (key: string) => (
      <CrossFadeText triggerKey={key}>
        <Label text={key} onMount={() => mounts.push(key)} />
      </CrossFadeText>
    );

    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = create(render('a'));
    });

    mounts.length = 0;

    act(() => {
      renderer.update(render('b'));
    });

    expect(mounts.sort()).toEqual(['a', 'b']);
    expect(opacities(renderer!)).toEqual([0, 1]);
  });

  test('the outgoing layer is dropped once the fade is done', () => {
    const render = (key: string) => (
      <CrossFadeText triggerKey={key} duration={300}>
        <Label text={key} onMount={() => {}} />
      </CrossFadeText>
    );

    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = create(render('a'));
    });

    act(() => {
      renderer.update(render('b'));
    });

    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(renderer!.root.findAllByProps({ testID: 'a' })).toEqual([]);
    expect(opacities(renderer!)).toEqual([1]);
  });
});
