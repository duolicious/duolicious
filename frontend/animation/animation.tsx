import { useCallback, useEffect } from 'react';
import {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useAppTheme } from '../app-theme/app-theme';
import { HOVER_DURATION_MS, useHover } from '../components/hover';

const usePressableAnimation = (isPressed = false) => {
  const { appTheme } = useAppTheme();
  const { hovered, hoverProps } = useHover();

  const restingValue = isPressed ? 1 : hovered ? 0.5 : 0;

  const progress = useSharedValue(restingValue);

  useEffect(() => {
    progress.set(withTiming(restingValue, { duration: HOVER_DURATION_MS }));
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
    progress.set(1);
  }, []);

  const onPressOut = useCallback(() => {
    progress.set(withTiming(restingValue, { duration: HOVER_DURATION_MS }));
  }, [restingValue]);

  return { backgroundStyle, onPressIn, onPressOut, hoverProps };
};

export {
  usePressableAnimation,
};
