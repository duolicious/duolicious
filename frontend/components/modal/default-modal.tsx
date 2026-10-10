import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Platform,
  StatusBar,
  StyleSheet,
  View,
  useWindowDimensions,
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
  const { width, height } = useWindowDimensions();
  // Track whether the modal should be mounted in the tree
  const [isMounted, setIsMounted] = useState(visible);

  // Opacity value for the fade animation
  const opacity = useRef(new Animated.Value(0)).current;

  // Whenever `visible` changes, run the fade in/out animation
  useEffect(() => {
    if (visible) {
      setIsMounted(true);
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
      style={[
        Platform.OS === 'web'
          ? { width: '100%', height: '100%' }
          : { width, height: height + (StatusBar?.currentHeight ?? 0) },
        styles.wrapper
      ]}
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
    ...StyleSheet.absoluteFillObject,
  },
});

export {
  DefaultModal
};

