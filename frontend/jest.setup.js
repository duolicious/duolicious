// Mock react-native-reanimated so that modules importing it — e.g.
// components/toast.tsx, pulled in transitively via util/util.tsx — can be
// loaded in the jest environment, which has no native Worklets runtime.
//
// The library's own `react-native-reanimated/mock` still transitively requires
// the native worklets module and throws at import time, so we provide a small
// self-contained mock covering the surface the app actually uses.
const { jest } = require('@jest/globals');

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View, Text, ScrollView, Image } = require('react-native');

  const identity = (v) => v;
  const noop = () => {};

  const createAnimatedComponent = (Component) =>
    React.forwardRef((props, ref) =>
      React.createElement(Component, { ...props, ref }),
    );

  const Animated = {
    View,
    Text,
    ScrollView,
    Image,
    createAnimatedComponent,
  };

  return {
    __esModule: true,
    default: Animated,
    ...Animated,
    useSharedValue: (initial) => ({ value: initial }),
    useDerivedValue: (fn) => ({ value: fn() }),
    useAnimatedStyle: (fn) => fn(),
    useAnimatedRef: () => React.createRef(),
    useAnimatedScrollHandler: () => noop,
    withTiming: identity,
    withSpring: identity,
    withDelay: (_delay, value) => value,
    withSequence: (...values) => values[values.length - 1],
    withRepeat: identity,
    cancelAnimation: noop,
    runOnJS: (fn) => fn,
    runOnUI: (fn) => fn,
    measure: noop,
    scrollTo: noop,
    interpolate: identity,
    interpolateColor: identity,
    makeMutable: (initial) => ({ value: initial }),
    Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
    Easing: new Proxy({}, { get: () => identity }),
  };
});
