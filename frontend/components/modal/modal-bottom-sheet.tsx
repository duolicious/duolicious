import {
  ReactNode,
  Ref,
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BackHandler,
  Platform,
  ScrollView,
  ScrollViewProps,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  ComposedGesture,
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import { Pressable } from '../pressable';
import Animated, {
  SharedValue,
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
import { SHEET_Z_INDEX } from '../../constants/constants';
import { viewportPosition } from '../../util/util';

const SLIDE_DURATION = 250;
const DISMISS_VELOCITY = 800;

// Gap kept below the status bar so the sheet's top never crowds the screen
// edge, where a downward swipe would reach the system pull-down instead
const TOP_GAP = 50;

const isWeb = Platform.OS === 'web';

const SheetScroll = createContext<{
  gesture: ComposedGesture
  scrollY: SharedValue<number>
} | null>(null);

const SheetScrollView = ({
  onScroll,
  ...props
}: ScrollViewProps & { ref?: Ref<ScrollView> }) => {
  const sheet = useContext(SheetScroll);
  const scrollY = sheet?.scrollY;

  useEffect(() => {
    scrollY?.set(0);
  }, [scrollY]);

  if (!sheet) {
    return <ScrollView onScroll={onScroll} {...props} />;
  }

  return (
    <GestureDetector gesture={sheet.gesture}>
      <ScrollView
        {...props}
        onScroll={(e) => {
          sheet.scrollY.set(e.nativeEvent.contentOffset.y);
          onScroll?.(e);
        }}
      />
    </GestureDetector>
  );
};

const ModalBottomSheet = ({
  visible,
  onRequestClose,
  onBackPress = onRequestClose,
  header,
  footer,
  children,
  heightFraction = 0.75,
  top = 0,
  onOpened,
  onClosed,
}: {
  visible: boolean
  onRequestClose: () => void
  onBackPress?: () => void
  // Rendered inside the drag zone, under the grab handle
  header?: ReactNode
  footer?: ReactNode
  children: ReactNode
  heightFraction?: number
  top?: number
  onOpened?: () => void
  onClosed?: () => void
}) => {
  const { appTheme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboard = useReanimatedKeyboardAnimation();
  const sheetHeight = Math.round(heightFraction * (windowHeight - top));

  const [isMounted, setIsMounted] = useState(visible);
  if (visible && !isMounted) {
    setIsMounted(true);
  }
  const translateY = useSharedValue(sheetHeight);
  const scrollY = useSharedValue(0);
  const isVisible = useSharedValue(visible);

  useEffect(() => {
    const onHardwareBackPress = () => {
      if (isMounted) {
        onBackPress();
        return true;
      }
      return false;
    };

    const subscription =
      BackHandler.addEventListener('hardwareBackPress', onHardwareBackPress);

    return () => subscription.remove();
  }, [isMounted, onBackPress]);

  const gestures = useMemo(() => {
    const open = () => {
      'worklet';
      translateY.set(withTiming(
        0,
        { duration: SLIDE_DURATION },
        (finished) => {
          if (finished && onOpened) {
            runOnJS(onOpened)();
          }
        },
      ));
    };

    const move = (translationY: number) => {
      'worklet';
      if (isVisible.get()) {
        translateY.set(Math.max(0, translationY));
      }
    };

    const release = (translationY: number, velocityY: number) => {
      'worklet';
      if (!isVisible.get()) {
        return;
      }

      if (translationY > sheetHeight / 3 || velocityY > DISMISS_VELOCITY) {
        runOnJS(onRequestClose)();
      } else {
        open();
      }
    };

    const drag = () => Gesture.Pan()
      .activeOffsetY(10)
      .onUpdate((e) => {
        'worklet';
        move(e.translationY);
      })
      .onEnd((e) => {
        'worklet';
        release(e.translationY, e.velocityY);
      });

    const content = drag().enabled(!isWeb);
    const scroll = Gesture.Native().blocksExternalGesture(content);
    const scrollTop = drag()
      .failOffsetY(-5)
      .blocksExternalGesture(content)
      .onTouchesDown((_, manager) => {
        'worklet';
        if (scrollY.get() > 0) {
          manager.fail();
        }
      });

    return {
      open,
      move,
      release,
      header: drag(),
      content,
      scroll: {
        gesture: Gesture.Exclusive(scrollTop, scroll),
        scrollY,
      },
    };
  }, [
    translateY,
    scrollY,
    isVisible,
    sheetHeight,
    onRequestClose,
    onOpened,
    isMounted,
  ]);

  useEffect(() => {
    if (!isMounted) {
      return;
    }

    isVisible.set(visible);

    if (visible) {
      translateY.set(sheetHeight);
      gestures.open();
    } else {
      translateY.set(withTiming(
        sheetHeight,
        { duration: SLIDE_DURATION },
        (finished) => {
          if (finished) {
            runOnJS(setIsMounted)(false);
          }
          if (finished && onClosed) {
            runOnJS(onClosed)();
          }
        },
      ));
    }
  }, [visible, isMounted]);

  const contentRef = useRef<View>(null);
  const currentGestures = useEffectEvent(() => gestures);

  useEffect(() => {
    const node = contentRef.current;
    if (!isWeb || !(node instanceof HTMLElement)) {
      return;
    }

    let touch: {
      id: number
      target: EventTarget
      startX: number
      startY: number
      lastY: number
      lastTime: number
      velocity: number
      isDragging: boolean
    } | null = null;
    let lastEvent: TouchEvent | null = null;

    const isInScrolledList = (target: EventTarget | null) => {
      for (
        let el = target instanceof Element ? target : null;
        el && el !== node;
        el = el.parentElement
      ) {
        if (el.scrollTop > 0) {
          return true;
        }
      }
      return false;
    };

    const findTouch = (touches: TouchList) =>
      Array.from(touches).find((t) => t.identifier === touch?.id);

    const untrack = () => {
      touch?.target.removeEventListener('touchmove', onTouchMove, true);
      touch?.target.removeEventListener('touchend', onTouchEnd, true);
      touch?.target.removeEventListener('touchcancel', onTouchEnd, true);
      touch = null;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (touch?.isDragging && findTouch(e.touches)) {
        return;
      }

      untrack();

      const { identifier, target, clientX, clientY } = e.touches[0];
      if (e.touches.length !== 1 || isInScrolledList(target)) {
        return;
      }

      touch = {
        id: identifier,
        target,
        startX: clientX,
        startY: clientY,
        lastY: clientY,
        lastTime: e.timeStamp,
        velocity: 0,
        isDragging: false,
      };
      target.addEventListener(
        'touchmove',
        onTouchMove,
        { capture: true, passive: false },
      );
      target.addEventListener('touchend', onTouchEnd, true);
      target.addEventListener('touchcancel', onTouchEnd, true);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e === lastEvent) {
        return;
      }
      lastEvent = e;

      const moved = findTouch(e.touches);
      if (!touch || !moved) {
        return;
      }

      const { clientX, clientY } = moved;
      const dx = clientX - touch.startX;
      const dy = clientY - touch.startY;

      if (!touch.isDragging && dy <= Math.abs(dx)) {
        untrack();
        return;
      }

      e.preventDefault();
      touch.isDragging = true;
      touch.velocity = 1000 * (clientY - touch.lastY) /
        Math.max(1, e.timeStamp - touch.lastTime);
      touch.lastY = clientY;
      touch.lastTime = e.timeStamp;
      currentGestures().move(dy);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e === lastEvent) {
        return;
      }
      lastEvent = e;

      if (!findTouch(e.changedTouches)) {
        return;
      }

      if (touch?.isDragging) {
        currentGestures().release(
          touch.lastY - touch.startY,
          e.timeStamp - touch.lastTime < 100 ? touch.velocity : 0,
        );
      }
      untrack();
    };

    node.addEventListener('touchstart', onTouchStart);
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', onTouchEnd);
    node.addEventListener('touchcancel', onTouchEnd);

    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchEnd);
      untrack();
    };
  }, [isMounted]);

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
        style={[StyleSheet.absoluteFill, backdropStyle]}
      >
        <Pressable
          onPress={onRequestClose}
          style={[StyleSheet.absoluteFill, backgroundColors.dark]}
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
          <GestureDetector gesture={gestures.header}>
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
          <GestureDetector gesture={gestures.content}>
            <View ref={contentRef} style={styles.content}>
              <SheetScroll value={isWeb ? null : gestures.scroll}>
                {children}
              </SheetScroll>
            </View>
          </GestureDetector>
          {footer}
        </Animated.View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFill,
    position: viewportPosition(),
    zIndex: SHEET_Z_INDEX,
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
  SheetScrollView,
};
