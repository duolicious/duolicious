import { ReactNode, useEffect, useRef, useState } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import Animated, {
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

type FadeLayersProps = {
  progress: SharedValue<number>
  front: ReactNode
  back: ReactNode
  style?: StyleProp<ViewStyle>
};

const FadeLayers = ({ progress, front, back, style }: FadeLayersProps) => {
  const frontStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const backStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));

  return (
    <View style={style}>
      <Animated.View style={frontStyle}>
        {front}
      </Animated.View>
      {back !== null &&
        <Animated.View
          style={[
            { position: 'absolute', width: '100%', height: '100%', justifyContent: 'center' },
            backStyle,
          ]}
          pointerEvents="none"
        >
          {back}
        </Animated.View>
      }
    </View>
  );
};

type CrossFadeProps = {
  showFront: boolean
  front: ReactNode
  back: ReactNode
  minBackMs?: number
  duration?: number
  style?: StyleProp<ViewStyle>
};

const CrossFade = ({
  showFront,
  front,
  back,
  minBackMs = 0,
  duration = 500,
  style,
}: CrossFadeProps) => {
  const progress = useSharedValue(0);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    if (!showFront) {
      return;
    }

    const remaining = Math.max(0, minBackMs - (Date.now() - mountedAt.current));

    progress.value = withDelay(remaining, withTiming(1, { duration }));
  }, [showFront]);

  return (
    <FadeLayers progress={progress} front={front} back={back} style={style} />
  );
};

type FadeTransitionProps = {
  front: ReactNode
  back: ReactNode
  duration: number
  onDone: () => void
  style?: StyleProp<ViewStyle>
};

// One of these per transition, so that the layers carry their own starting
// opacities into the commit that mounts them. Setting those opacities on layers
// that are already mounted sends them to the UI thread by a separate route,
// which lets Android paint a frame where the incoming layer is hidden and the
// outgoing layer has yet to arrive.
const FadeTransition = ({
  front,
  back,
  duration,
  onDone,
  style,
}: FadeTransitionProps) => {
  const progress = useSharedValue(back === null ? 1 : 0);

  useEffect(() => {
    if (back === null) {
      return;
    }

    progress.value = withTiming(1, { duration });

    const timeout = setTimeout(onDone, duration);

    return () => clearTimeout(timeout);
  }, []);

  return (
    <FadeLayers progress={progress} front={front} back={back} style={style} />
  );
};

type CrossFadeTextProps = {
  triggerKey: string
  children: ReactNode
  duration?: number
  style?: StyleProp<ViewStyle>
};

const CrossFadeText = ({
  triggerKey,
  children,
  duration = 300,
  style,
}: CrossFadeTextProps) => {
  const [tx, setTx] = useState<{ key: string, outgoing: ReactNode }>({
    key: triggerKey,
    outgoing: null,
  });
  const lastChildren = useRef(children);

  if (tx.key !== triggerKey) {
    setTx({ key: triggerKey, outgoing: lastChildren.current });
  }

  useEffect(() => {
    lastChildren.current = children;
  });

  return (
    <FadeTransition
      key={tx.key}
      front={children}
      back={tx.outgoing}
      duration={duration}
      onDone={() => setTx((t) => ({ ...t, outgoing: null }))}
      style={style}
    />
  );
};

export {
  CrossFade,
  CrossFadeText,
};
