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
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { backgroundColors } from './background-colors';
import { useAppTheme } from '../../app-theme/app-theme';

const SLIDE_DURATION = 250;
const DISMISS_VELOCITY = 800;

// Gap kept below the status bar so the sheet's top never crowds the screen
// edge, where a downward swipe would reach the system pull-down instead
const TOP_GAP = 50;

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
  const keyboard = useReanimatedKeyboardAnimation();
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

  const sheetStyle = useAnimatedStyle(() => {
    // The window doesn't resize when the on-screen keyboard opens, so grow the
    // sheet upward to lift its content (and the search input in the header)
    // above the keyboard, capping the top below the status bar so the drag
    // handle stays reachable. The sheet itself still spans to the bottom of the
    // screen; `paddingBottom` insets only the scrollable content to the top of
    // the keyboard, letting the sheet's own colour fill behind the keyboard and
    // its rounded corners. `keyboard.height` is 0 when closed and on web, where
    // the browser scrolls the input into view
    const keyboardHeight = Math.abs(keyboard.height.value);
    return {
      height: Math.min(
        sheetHeight + keyboardHeight,
        windowHeight - insets.top - TOP_GAP,
      ),
      paddingBottom: Math.max(keyboardHeight, insets.bottom),
      transform: [{ translateY: translateY.value }],
    };
  });

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
      <View
        style={styles.avoidingView}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            {
              backgroundColor: appTheme.primaryColor,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
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
      </View>
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
