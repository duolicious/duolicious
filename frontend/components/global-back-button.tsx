import { useCallback, useLayoutEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons/faArrowLeft';
import { useAppTheme } from '../app-theme/app-theme';
import { getBackButtonState, useBackButtonState } from '../events/back-button';
import type { BackButtonPlacement } from '../events/back-button';
import { TIMING } from '../util/animation';
import { COLUMN_MAX_WIDTH } from '../constants/constants';

const onPress = () => {
  const state = getBackButtonState();
  if (!state.pressable) return;
  state.placement?.onPress();
};

const GlobalBackButton = () => {
  const { placement } = useBackButtonState();
  const { width } = useWindowDimensions();
  const { appTheme } = useAppTheme();
  const insets = useSafeAreaInsets();

  const top = (Platform.OS === 'ios' ? 0 : 10)
    + (Platform.OS === 'web' ? 0 : insets.top);

  const [shown, setShown] = useState<BackButtonPlacement | null>(null);

  const opacity = useSharedValue(0);
  const translateX = useSharedValue(0);

  const hide = useCallback(() => setShown(null), []);

  const targetX = placement?.layout === 'column'
    ? Math.max(0, (width - COLUMN_MAX_WIDTH) / 2)
    : 0;

  useLayoutEffect(() => {
    const previous = shown;

    if (!placement && !previous) return;

    if (!placement && previous?.transition === 'instant') {
      opacity.value = 0;
      setShown(null);
      return;
    }

    if (!placement) {
      opacity.value = withTiming(0, TIMING, (finished) => {
        if (finished) runOnJS(hide)();
      });
      return;
    }

    setShown(placement);

    if (!previous) {
      translateX.value = targetX;
      opacity.value = placement.transition === 'fade'
        ? withTiming(1, TIMING)
        : 1;
      return;
    }

    opacity.value = withTiming(1, TIMING);
    translateX.value = withTiming(targetX, TIMING);
  }, [placement, targetX]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  if (!shown) return null;

  return (
    <Reanimated.View style={[styles.container, { top }, animatedStyle]}>
      <Pressable
        style={[
          styles.button,
          {
            backgroundColor: appTheme.primaryColor,
            borderColor: appTheme.secondaryColor,
          },
        ]}
        onPress={onPress}
      >
        <FontAwesomeIcon
          icon={faArrowLeft}
          size={24}
          style={{
            color: appTheme.secondaryColor,
            // @ts-ignore
            outline: 'none',
          }}
        />
      </Pressable>
    </Reanimated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    zIndex: 999,
  },
  button: {
    borderRadius: 999,
    marginLeft: 10,
    width: 45,
    height: 45,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});

export {
  GlobalBackButton,
};
