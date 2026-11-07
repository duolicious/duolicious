import { useState, useEffect } from 'react';
import { Animated } from 'react-native';
import { Logo16 } from './logo';

const SplashScreen = ({ loading }: { loading: boolean }) => {
  const [isFaded, setIsFaded] = useState(false);
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!loading) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }).start(() => setIsFaded(true));
    }
  }, [loading]);

  if (isFaded) {
    return null;
  } else {
    return (
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          alignItems: 'center',
          flexDirection: 'column',
          justifyContent: 'space-around',
          backgroundColor: '#70f',
          opacity: opacity,
          zIndex: 999,
        }}
      >
        <Logo16 size={96} fadeOutDelay={0} fadeInDelay={0} doAnimate={true} />
      </Animated.View>
    );
  }
};

export { SplashScreen };
