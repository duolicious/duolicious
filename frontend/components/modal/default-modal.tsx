import { useEffect, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  StyleSheet,
  View,
} from 'react-native';
import { viewportPosition } from '../../util/util';

/*
 * React Native has a `Modal` element but it has a bug on Android
 */

const DefaultModal = ({
  visible,
  transparent,
  onRequestClose,
  children
}: {
  visible: boolean
  transparent: boolean
  onRequestClose?: () => void,
  children: React.ReactNode
}) => {
  // Track whether the modal should be mounted in the tree
  const [isMounted, setIsMounted] = useState(visible);
  if (visible && !isMounted) {
    setIsMounted(true);
  }

  // Opacity value for the fade animation
  const [opacity] = useState(() => new Animated.Value(0));

  // Whenever `visible` changes, run the fade in/out animation
  useEffect(() => {
    if (visible) {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
        easing: Easing.linear,
      }).start();
    } else {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
        easing: Easing.linear,
      }).start(({ finished }) => {
        if (finished) {
          setIsMounted(false);
        }
      });
    }
  }, [visible, opacity]);

  // Handle the hardware back button on Android
  useEffect(() => {
    const onBackPress = () => {
      // If the modal is currently visible, we call onRequestClose
      // and intercept the default back action.
      if (isMounted) {
        onRequestClose?.();
        return true;
      }
      return false;
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);

    return () => {
      subscription.remove();
    };
  }, [isMounted, onRequestClose]);

  if (!isMounted) {
    return null;
  }

  return (
    <View
      style={styles.wrapper}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      {/* Animated container to handle the 'fade' effect */}
      <Animated.View
        style={[
          styles.container,
          {
            backgroundColor: transparent ? 'transparent' : 'white',
            opacity,
          }
        ]}
      >
        {/* Your modal content goes here */}
        {children}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: viewportPosition(),
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: 'transparent',
  },
  container: {
    ...StyleSheet.absoluteFill,
  },
});

export {
  DefaultModal
};

