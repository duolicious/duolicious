import { Platform } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useEffect, useMemo } from 'react';
import { useAppTheme } from '../app-theme/app-theme';

const TRACK_WIDTH = 48;
const TRACK_HEIGHT = 28;
const THUMB_SIZE = 22;
const TRACK_PADDING = 3;
const TRAVEL = TRACK_WIDTH - THUMB_SIZE - 2 * TRACK_PADDING;
const ON_COLOR = '#7700ff';
const DURATION = 150;

const Toggle = ({
  value,
  onValueChange,
}: {
  value: boolean
  onValueChange: (next: boolean) => void
}) => {
  const { appThemeName } = useAppTheme();
  const offColor = appThemeName === 'dark' ? '#54555f' : '#cccccc';

  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, { duration: DURATION });
  }, [value]);

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [offColor, ON_COLOR],
    ),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * TRAVEL }],
  }));

  const gesture = useMemo(
    () => Gesture.Tap().onEnd(() => runOnJS(onValueChange)(!value)),
    [onValueChange, value],
  );

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
        style={[
          {
            width: TRACK_WIDTH,
            height: TRACK_HEIGHT,
            borderRadius: 999,
            padding: TRACK_PADDING,
            justifyContent: 'center',
            ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
          },
          trackStyle,
        ]}
      >
        <Animated.View
          style={[
            {
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderRadius: 999,
              backgroundColor: '#ffffff',
            },
            thumbStyle,
          ]}
        />
      </Animated.View>
    </GestureDetector>
  );
};

export {
  Toggle,
};
