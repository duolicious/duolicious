import {
  useState,
  useEffect,
} from 'react';
import { View, Animated } from 'react-native';

const IndeterminateProgressBar = (props: { show?: boolean }) => {
  const { show = true } = props;

  const [animationValue] = useState(() => new Animated.Value(0));

  const interpolatedWidth = animationValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '90%'],
    extrapolate: 'clamp',
  });

  const interpolatedOpacity = animationValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });

  useEffect(() => {
    animationValue.setValue(0);

    const animationToEnd = Animated.timing(animationValue, {
      toValue: 1,
      duration: 666,
      useNativeDriver: false,
    });

    const resetAnimation = Animated.timing(animationValue, {
      toValue: 0,
      duration: 666,
      useNativeDriver: false,
    });

    const sequenceAnimation = Animated.sequence([
      animationToEnd, resetAnimation
    ]);

    const loopAnimation = Animated.loop(sequenceAnimation);

    if (show) {
      loopAnimation.start();
    } else {
      loopAnimation.stop();
    }
  }, [show]);

  return (
    <View style={{
        flexDirection: 'row',
        width: '100%',
        height: 2,
        overflow: 'hidden',
        opacity: show ? 1 : 0,
    }}>
      <Animated.View style={{
          width: interpolatedWidth,
          height: '100%',
      }} />
      <Animated.View style={{
        opacity: interpolatedOpacity,
        width: '10%',
        height: '100%',
        backgroundColor: '#70f',
      }} />
    </View>
  );
};

export {
  IndeterminateProgressBar,
}
