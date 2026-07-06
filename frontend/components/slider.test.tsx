import { describe, expect, jest, test } from '@jest/globals';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Slider } from './slider';

jest.mock('react-native-gesture-handler', () => {
  // A chainable stand-in for Gesture.Pan(): every property access returns a
  // function which returns the gesture again
  const gesture: object = new Proxy({}, { get: () => () => gesture });
  return {
    Gesture: { Pan: () => gesture },
    GestureDetector: ({ children }: { children: unknown }) => children,
  };
});

jest.mock('../app-theme/app-theme', () => ({
  useAppTheme: () => ({ appTheme: { interactiveBorderColor: '#ccc' } }),
}));

const thumbDiameter = 32;

const layout = (renderer: ReactTestRenderer, width: number) => {
  const [container] = renderer.root.findAll(
    (node) => typeof node.props.onLayout === 'function'
  );
  act(() => {
    container.props.onLayout({ nativeEvent: { layout: { width } } });
  });
};

describe('Slider', () => {
  test('reports the initial value after layout', () => {
    const onValueChange = jest.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <Slider
          initialValue={250}
          minimumValue={5}
          maximumValue={500}
          onValueChange={onValueChange}
        />
      );
    });

    layout(renderer, 300 + thumbDiameter);

    expect(onValueChange).toHaveBeenLastCalledWith(250);
  });

  test('keeps its value across zero-width layouts from hidden tabs', () => {
    const onValueChange = jest.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <Slider
          initialValue={250}
          minimumValue={5}
          maximumValue={500}
          onValueChange={onValueChange}
        />
      );
    });

    layout(renderer, 300 + thumbDiameter);

    // Hiding the tab makes the view report a zero-width layout, then showing
    // it again reports the original width
    layout(renderer, 0);
    layout(renderer, 300 + thumbDiameter);

    expect(onValueChange).not.toHaveBeenCalledWith(5);
    expect(onValueChange).toHaveBeenLastCalledWith(250);
  });

  test('preserves the current value when the width changes', () => {
    const onValueChange = jest.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <Slider
          initialValue={250}
          minimumValue={5}
          maximumValue={500}
          onValueChange={onValueChange}
        />
      );
    });

    layout(renderer, 300 + thumbDiameter);
    layout(renderer, 600 + thumbDiameter);

    expect(onValueChange).toHaveBeenLastCalledWith(250);
  });
});
