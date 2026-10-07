import { useCallback, useEffect } from 'react';
import {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '../app-theme/app-theme';
import { HOVER_DURATION_MS, useHover } from '../components/hover';

const SHAKE_STEP = { duration: 75, easing: Easing.linear };

const useShake = () => {
  const offset = useSharedValue(0);

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  const startShake = useCallback(() => {
    offset.value = withSequence(
      withTiming(-25, SHAKE_STEP),
      withTiming(20, SHAKE_STEP),
      withTiming(-15, SHAKE_STEP),
      withTiming(0, SHAKE_STEP),
    );
  }, []);

  return { shakeStyle, startShake };
};

const usePressableAnimation = (isPressed = false) => {
  const { appTheme } = useAppTheme();
  const { hovered, hoverProps } = useHover();

  const restingValue = isPressed ? 1 : hovered ? 0.5 : 0;

  const progress = useSharedValue(restingValue);

  useEffect(() => {
    progress.value = withTiming(restingValue, { duration: HOVER_DURATION_MS });
  }, [restingValue]);

  const colors = [
    appTheme.primaryColor,
    appTheme.hoverColor,
    `${appTheme.interactiveBorderColor}80`,
  ];

  const backgroundStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 0.5, 1], colors),
  }), colors);

  const onPressIn = useCallback(() => {
    progress.value = 1;
  }, []);

  const onPressOut = useCallback(() => {
    progress.value = withTiming(restingValue, { duration: HOVER_DURATION_MS });
  }, [restingValue]);

  return { backgroundStyle, onPressIn, onPressOut, hovered, hoverProps };
};

export {
  useShake,
  usePressableAnimation,
};
