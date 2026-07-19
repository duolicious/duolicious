import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  Animated,
  View,
  PanResponder,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import {
  LinearGradient,
} from 'expo-linear-gradient';
import { noSelect } from '../../../styles';
import {
  clamp,
} from './util';

type SaturationValuePickerRef = {
  getSaturation: () => number;
  setSaturation: (n: number) => void;
  getValue: () => number;
  setValue: (n: number) => void;
  getHue: () => number;
  setHue: (n: number) => void;
};

type SaturationValuePickerProps = {
  borderRadius: number;
  size: number;
  sliderSize: number;
  hue: number;
  saturation: number;
  value: number;
  containerStyle?: ViewStyle;
  onDragMove?: () => void;
}

const SaturationValuePicker = forwardRef<
  SaturationValuePickerRef,
  SaturationValuePickerProps
>((props, ref) => {
  const {
    borderRadius,
    size,
    sliderSize,
    hue: initialHue,
    saturation,
    value,
    containerStyle = {},
    onDragMove,
  } = props;

  const hueColors = [
    '#ff0000',
    '#ffff00',
    '#00ff00',
    '#00ffff',
    '#0000ff',
    '#ff00ff',
    '#ff0000',
  ];

  const initialXY = {
    x: clamp(size * saturation),
    y: clamp(size * value),
  };

  const hue = useRef(initialHue);
  const animatedHue = useRef(new Animated.Value(initialHue));

  const baseSliderXY = useRef(initialXY);
  const sliderXY = useRef(initialXY);
  const animatedSliderXY = useRef(new Animated.ValueXY(initialXY));

  const backgroundColor = animatedHue.current.interpolate({
    inputRange: hueColors.map((_, i) => i * 360 / (hueColors.length - 1)),
    outputRange: hueColors,
  });

  const backgroundColorX = animatedSliderXY.current.x.interpolate({
    inputRange: [0, size],
    outputRange: ['rgba(255, 255, 255, 1)', 'rgba(255, 255, 255, 0)'],
  });

  const backgroundColorY = animatedSliderXY.current.y.interpolate({
    inputRange: [0, size],
    outputRange: ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 1)'],
  });

  const getHue = useCallback(
    () => hue.current, [hue]);
  const getSaturation = useCallback(
    () => sliderXY.current.x / size, [sliderXY]);
  const getValue = useCallback(
    () => 1 - sliderXY.current.y / size, [sliderXY]);

  const setHue = useCallback(
    (n: number) => {
      hue.current = n;
      animatedHue.current.setValue(n);
    },
    [hue, animatedHue]);
  const setSaturation = useCallback(
    (n: number) => {
      const updated = {
        x: n * size,
        y: sliderXY.current.y,
      };

      baseSliderXY.current = updated;
      sliderXY.current = updated;
      animatedSliderXY.current.setValue(updated);
    },
    [sliderXY, getValue]);
  const setValue = useCallback(
    (n: number) => {
      const updated = {
        x: sliderXY.current.x,
        y: (1 - n) * size,
      };

      baseSliderXY.current = updated;
      sliderXY.current = updated;
      animatedSliderXY.current.setValue(updated);
    },
    [sliderXY, getSaturation]);

  useImperativeHandle(
    ref,
    () => ({
      getHue,
      setHue,
      getSaturation,
      setSaturation,
      getValue,
      setValue,
    }),
    [
      getHue,
      setHue,
      getSaturation,
      setSaturation,
      getValue,
      setValue,
    ]
  );

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_, gestureState) => {
      const clampedX = clamp(baseSliderXY.current.x + gestureState.dx, 0, size);
      const clampedY = clamp(baseSliderXY.current.y + gestureState.dy, 0, size);

      const updated = { x: clampedX, y: clampedY };

      animatedSliderXY.current.setValue(updated);
      sliderXY.current = updated;

      onDragMove && onDragMove();
    },
    onPanResponderRelease: (_, gestureState) => {
      const clampedX = clamp(baseSliderXY.current.x + gestureState.dx, 0, size);
      const clampedY = clamp(baseSliderXY.current.y + gestureState.dy, 0, size);

      baseSliderXY.current = { x: clampedX, y: clampedY };
    },
    onPanResponderTerminationRequest: () => false,
  })).current;

  return (
    <View
      style={[
        styles.container,
        containerStyle,
        {
          height: size + sliderSize,
          width: size + sliderSize,
        },
      ]}
    >
      <Animated.View style={{ backgroundColor }}>
        <LinearGradient
          style={[{ borderRadius }, styles.linearGradient]}
          colors={['rgba(255, 255, 255, 1)', 'rgba(255, 255, 255, 0)']}
          start={[0, 0.5]}
          end={[1, 0.5]}
        >
          <LinearGradient
            colors={['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 1)']}
            style={{ height: size, width: size }}
          />
        </LinearGradient>
      </Animated.View>
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.slider,
          {
            backgroundColor: backgroundColor,
            width: sliderSize,
            height: sliderSize,
            borderRadius: sliderSize / 2,
            borderWidth: sliderSize / 10,
            transform: [
              { translateX: animatedSliderXY.current.x },
              { translateY: animatedSliderXY.current.y },
            ],
            overflow: 'hidden',
          },
        ]}
      >
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.slider,
            {
              backgroundColor: backgroundColorX,
              width: sliderSize,
              height: sliderSize,
            },
          ]}
        >
          <Animated.View
            {...panResponder.panHandlers}
            style={[
              styles.slider,
              {
                backgroundColor: backgroundColorY,
                width: sliderSize,
                height: sliderSize,
              },
            ]}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  slider: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderColor: '#fff',
    ...noSelect,
    // @ts-ignore
    touchAction: 'none',
  },
  linearGradient: {
    overflow: 'hidden',
  },
});

export {
  SaturationValuePicker,
  SaturationValuePickerRef,
};
