import {
  Animated,
  Easing,
} from 'react-native';
import {
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { useAppTheme } from '../app-theme/app-theme';


const useShake = (): [Animated.Value, () => void] => {
  const shakeAnimation = useRef(new Animated.Value(0)).current;

  const startShake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnimation, {
        toValue: -25,
        duration: 75,
        useNativeDriver: true,
        easing: Easing.linear
      }),
      Animated.timing(shakeAnimation, {
        toValue: 20,
        duration: 75,
        useNativeDriver: true,
        easing: Easing.linear
      }),
      Animated.timing(shakeAnimation, {
        toValue: -15,
        duration: 75,
        useNativeDriver: true,
        easing: Easing.linear
      }),
      Animated.timing(shakeAnimation, {
        toValue: 0,
        duration: 75,
        useNativeDriver: true,
        easing: Easing.linear
      })
    ]).start();
  }, [shakeAnimation]);

  return [shakeAnimation, startShake];
};

const usePressableAnimation = (isPressed = false) => {
  const { appTheme } = useAppTheme();

  const restingValue = isPressed ? 1 : 0;

  const animatedBackgroundColor = useRef(new Animated.Value(restingValue)).current;

  useEffect(() => {
    animatedBackgroundColor.setValue(restingValue);
  }, [restingValue]);

  const backgroundColor = animatedBackgroundColor.interpolate({
    inputRange: [0, 1],
    outputRange: [`${appTheme.primaryColor}ff`, `${appTheme.interactiveBorderColor}80`],
    extrapolate: 'clamp',
  });

  const onPressIn = useCallback(() => {
    Animated.timing(animatedBackgroundColor, {
      toValue: 1,
      duration: 0,
      useNativeDriver: true,
    }).start();
  }, []);

  const onPressOut = useCallback(() => {
    Animated.timing(animatedBackgroundColor, {
      toValue: restingValue,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [restingValue]);

  return { backgroundColor, onPressIn, onPressOut };
};

export {
  useShake,
  usePressableAnimation,
};
