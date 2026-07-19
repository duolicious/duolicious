import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import {
  LinearGradient,
} from 'expo-linear-gradient';
import { noSelect } from '../../../styles';
import {
  clamp,
} from './util';

type HuePickerProps = {
  borderRadius: number;
  hue: number;
  barWidth: number;
  barHeight: number;
  sliderSize: number;
  onDragMove?: () => void;
  containerStyle?: ViewStyle;
}

type HuePickerRef = {
  getHue: () => number;
  setHue: (h: number) => void;
};

const HuePicker = forwardRef<
  HuePickerRef,
  HuePickerProps
>((props, ref) => {
  const {
    borderRadius,
    hue,
    barWidth,
    barHeight,
    sliderSize,
    onDragMove,
    containerStyle = {}
  } = props;

  const hueColors: readonly [string, string, ...string[]] = [
    '#ff0000',
    '#ffff00',
    '#00ff00',
    '#00ffff',
    '#0000ff',
    '#ff00ff',
    '#ff0000',
  ];

  const initialY = clamp(hue, 0, 360);

  const baseSliderY = useRef(initialY);
  const sliderY = useRef(initialY);
  const animatedSliderY = useRef(new Animated.Value(initialY));

  const backgroundColor = animatedSliderY.current.interpolate({
    inputRange: hueColors.map((_, i) => i * barHeight / (hueColors.length - 1)),
    outputRange: Array.from(hueColors),
  });

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderMove: (_, gestureState) => {
      const clamped = clamp(
        baseSliderY.current + gestureState.dy,
        0,
        barHeight,
      );

      animatedSliderY.current.setValue(clamped);
      sliderY.current = clamped;

      onDragMove && onDragMove();
    },
    onPanResponderRelease: (_, gestureState) => {
       const clamped = clamp(
        baseSliderY.current + gestureState.dy,
        0,
        barHeight,
      );

      baseSliderY.current = clamped;
    },
    onPanResponderTerminationRequest: () => false,
  })).current;

  const getHue = useCallback(() => clamp(
    sliderY.current / barHeight * 360,
    0,
    360
  ), [sliderY, barHeight]);

  const setHue = useCallback((h: number) => {
    const clamped = clamp(h / 360 * barHeight, 0, barHeight);

    baseSliderY.current = clamped;
    sliderY.current = clamped;
    animatedSliderY.current.setValue(clamped);
  }, [barHeight, baseSliderY, sliderY, animatedSliderY]);

  useImperativeHandle(ref, () => ({ getHue, setHue }), [getHue, setHue]);

  return (
    <View style={[
      styles.container,
      containerStyle,
      {
        paddingTop: sliderSize / 2,
        paddingBottom: sliderSize / 2,
      },
    ]}>
      <LinearGradient
        colors={hueColors}
        style={{ borderRadius, width: barWidth, height: barHeight }}
      />
      <Animated.View
        {...panResponder.panHandlers}
        style={[
          styles.slider,
          {
            backgroundColor: backgroundColor,
            borderRadius: sliderSize / 2,
            borderWidth: sliderSize / 10,
            width: sliderSize,
            height: sliderSize,
            transform: [
              { translateY: animatedSliderY.current }
            ],
          }
        ]}
      />
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
    borderColor: '#fff',
    // @ts-ignore
    touchAction: 'none',
    ...noSelect,
  },
});

export {
  HuePicker,
  HuePickerRef,
};
