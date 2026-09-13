import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  SharedValue,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { listen, notify } from '../events/events';
import { RenderedHoc } from './rendered-hoc';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DefaultText } from './default-text';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faLink } from '@fortawesome/free-solid-svg-icons/faLink';
import { useAppTheme } from '../app-theme/app-theme';

const SOMETHING_WENT_WRONG = "Something went wrong";

const HIDDEN_POSITION = -500;
const SLIDE_DURATION = 300;
const HOLD_DURATION = 3000;
const SWIPE_DISMISS_THRESHOLD = 20;

type ToastItem = {
  Content: React.FC,
  holdDuration: number,
};

const slideOut = (
  translateY: SharedValue<number>,
  onDismiss: () => void,
  duration: number = SLIDE_DURATION,
) => {
  'worklet';
  translateY.value = withTiming(HIDDEN_POSITION, { duration }, (finished) => {
    if (finished) {
      runOnJS(onDismiss)();
    }
  });
};

const slideInAndHold = (
  translateY: SharedValue<number>,
  onDismiss: () => void,
  holdDuration: number,
) => {
  'worklet';
  translateY.value = withSequence(
    withTiming(0, { duration: SLIDE_DURATION }),
    withDelay(
      holdDuration,
      withTiming(HIDDEN_POSITION, { duration: SLIDE_DURATION }, (finished) => {
        if (finished) {
          runOnJS(onDismiss)();
        }
      }),
    ),
  );
};

const Toast: React.FC = () => {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(HIDDEN_POSITION);

  const [toastQueue, setToastQueue] = useState<ToastItem[]>([]);
  const [currentToast, setCurrentToast] = useState<ToastItem | null>(null);

  const dismiss = useCallback(() => setCurrentToast(null), []);

  const swipeUp = useMemo(
    () => Gesture.Pan()
      .onUpdate((e) => {
        'worklet';
        if (e.translationY < 0) {
          translateY.value = e.translationY;
        }
      })
      .onEnd((e) => {
        'worklet';
        if (e.translationY < -SWIPE_DISMISS_THRESHOLD) {
          slideOut(translateY, dismiss, SLIDE_DURATION / 2);
        } else {
          slideInAndHold(translateY, dismiss, HOLD_DURATION);
        }
      }),
    [translateY, dismiss],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  useEffect(() => {
    const head = toastQueue[0];
    const tail = toastQueue.slice(1);

    if (currentToast === null && head) {
      // `head` is a component; wrap it so React's setter stores it rather than
      // invoking it as a state updater.
      setCurrentToast(() => head);
      setToastQueue(tail);
    }
  }, [toastQueue.length, currentToast]);

  useEffect(() => {
    if (!currentToast) {
      return;
    }

    translateY.value = HIDDEN_POSITION;
    slideInAndHold(translateY, dismiss, currentToast.holdDuration);
  }, [currentToast === null]);

  useEffect(() => {
    const appendToast = (content: React.FC | ToastItem) => {
      const item = typeof content === 'function'
        ? { Content: content, holdDuration: HOLD_DURATION }
        : content;
      setToastQueue(prevQueue => [...prevQueue, item]);
    };

    return listen<React.FC | ToastItem>('toast', appendToast);
  }, []);

  if (currentToast) {
    return (
      <Animated.View
        pointerEvents="box-none"
        style={[
          {
            position: 'absolute',
            top: insets.top,
            left: 0,
            right: 0,
            alignItems: 'center',
            justifyContent: 'center',
          },
          animatedStyle,
        ]}
      >
        <GestureDetector gesture={swipeUp}>
          <View>
            <RenderedHoc Hoc={currentToast.Content}/>
          </View>
        </GestureDetector>
      </Animated.View>
    );
  } else {
    return null;
  }
};

const ToastContainer = ({children}: {children?: React.ReactNode}) => {
  const { appTheme } = useAppTheme();

  return (
    <View
      style={{
        marginTop: 10,
        marginHorizontal: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: appTheme.primaryColor,
        borderRadius: 999,
        paddingVertical: 10,
        paddingHorizontal: 20,
        flexDirection: 'row',
        shadowOffset: {
          width: 0,
          height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 8,
        gap: 10,
      }}
    >
      {children}
    </View>
  );
};

const SomethingWentWrongToast = () => {
  const { appTheme } = useAppTheme();

  return (
    <ToastContainer>
      <DefaultText
        style={{
          color: appTheme.secondaryColor,
          fontWeight: '700',
          textAlign: 'center',
        }}
      >
        {SOMETHING_WENT_WRONG}
      </DefaultText>
    </ToastContainer>
  );
};

const ValidationErrorToast = ({error}: {error: string}) => {
  return (
    <ToastContainer>
      <DefaultText
        style={{
          color: 'red',
          fontWeight: '700',
          textAlign: 'center',
        }}
      >
        {error}
      </DefaultText>
    </ToastContainer>
  );
};

const notifyErrorToast = (error: string) =>
  notify<React.FC>('toast', () => <ValidationErrorToast error={error} />);

const notifyIconToast = (
  label: string,
  icon: (color: string) => React.ReactNode,
  holdDuration: number = HOLD_DURATION,
) => {
  const Toast: React.FC = () => {
    const { appTheme } = useAppTheme();

    return (
      <ToastContainer>
        {icon(appTheme.secondaryColor)}
        <DefaultText style={{ color: appTheme.secondaryColor, fontWeight: '700' }}>
          {label}
        </DefaultText>
      </ToastContainer>
    );
  };
  notify<ToastItem>('toast', { Content: Toast, holdDuration });
};

const notifyLinkCopiedToast = (label: string) =>
  notifyIconToast(label, (color) =>
    <FontAwesomeIcon icon={faLink} color={color} size={24} />
  );

export {
  SOMETHING_WENT_WRONG,
  SomethingWentWrongToast,
  Toast,
  ToastContainer,
  ValidationErrorToast,
  notifyErrorToast,
  notifyIconToast,
  notifyLinkCopiedToast,
};
