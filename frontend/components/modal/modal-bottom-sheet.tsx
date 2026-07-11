import { ReactNode, useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { backgroundColors } from './background-colors';
import { useAppTheme } from '../../app-theme/app-theme';

const SLIDE_DURATION = 250;
const DISMISS_VELOCITY = 800;

const ModalBottomSheet = ({
  visible,
  onRequestClose,
  header,
  footer,
  children,
  heightFraction = 0.75,
}: {
  visible: boolean
  onRequestClose: () => void
  // Rendered inside the drag zone, under the grab handle
  header?: ReactNode
  footer?: ReactNode
  children: ReactNode
  heightFraction?: number
}) => {
  const { appTheme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = Math.round(heightFraction * windowHeight);

  const [isMounted, setIsMounted] = useState(visible);
  const translateY = useSharedValue(sheetHeight);

  useEffect(() => {
    if (visible) {
      setIsMounted(true);
    }
  }, [visible]);

  useEffect(() => {
    if (!isMounted) {
      return;
    }

    if (visible) {
      translateY.value = sheetHeight;
      translateY.value = withTiming(0, { duration: SLIDE_DURATION });
    } else {
      translateY.value = withTiming(
        sheetHeight,
        { duration: SLIDE_DURATION },
        (finished) => {
          if (finished) {
            runOnJS(setIsMounted)(false);
          }
        },
      );
    }
  }, [visible, isMounted]);

  useEffect(() => {
    const onBackPress = () => {
      if (isMounted) {
        onRequestClose();
        return true;
      }
      return false;
    };

    const subscription =
      BackHandler.addEventListener('hardwareBackPress', onBackPress);

    return () => subscription.remove();
  }, [isMounted, onRequestClose]);

  const pan = useMemo(
    () => Gesture.Pan()
      .activeOffsetY(10)
      .onUpdate((e) => {
        'worklet';
        translateY.value = Math.max(0, e.translationY);
      })
      .onEnd((e) => {
        'worklet';
        if (
          e.translationY > sheetHeight / 3 ||
          e.velocityY > DISMISS_VELOCITY
        ) {
          runOnJS(onRequestClose)();
        } else {
          translateY.value = withTiming(0, { duration: SLIDE_DURATION });
        }
      }),
    [translateY, sheetHeight, onRequestClose],
  );

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, sheetHeight], [1, 0]),
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!isMounted) {
    return null;
  }

  return (
    <View
      style={styles.wrapper}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <Animated.View
        style={[StyleSheet.absoluteFillObject, backdropStyle]}
      >
        <Pressable
          onPress={onRequestClose}
          style={[StyleSheet.absoluteFillObject, backgroundColors.dark]}
        />
      </Animated.View>
      <KeyboardAvoidingView
        behavior="padding"
        style={styles.avoidingView}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            {
              height: sheetHeight,
              // When the keyboard opens, the avoiding view shrinks; without
              // this the fixed-height sheet overflows off the top of the
              // screen, clipping the handle and search input
              maxHeight: '100%',
              backgroundColor: appTheme.primaryColor,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingBottom: insets.bottom,
              overflow: 'hidden',
            },
            sheetStyle,
          ]}
        >
          <GestureDetector gesture={pan}>
            <View>
              <View
                style={{
                  alignSelf: 'center',
                  width: 36,
                  height: 4,
                  borderRadius: 999,
                  marginVertical: 8,
                  backgroundColor: appTheme.reactionBarBorderColor,
                }}
              />
              {header}
            </View>
          </GestureDetector>
          <View style={styles.content}>
            {children}
          </View>
          {footer}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  avoidingView: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  content: {
    flex: 1,
  },
});

export {
  ModalBottomSheet,
};
