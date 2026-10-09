import { Platform, StyleSheet, View, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faCheck } from '@fortawesome/free-solid-svg-icons/faCheck';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DefaultText } from './default-text';
import { useAppTheme } from '../app-theme/app-theme';
import { HOVER_DURATION_MS, PURPLE_HOVER_COLOR, useHover } from './hover';

const COLOR = '#70f';
const SIZE = 22;
const DURATION = 150;

const Box = ({ value, hovered, style }: {
  value: boolean,
  hovered: boolean,
  style?: ViewStyle,
}) => {
  const { appTheme } = useAppTheme();
  const progress = useSharedValue(value ? 1 : 0);
  const hoverProgress = useSharedValue(0);
  const hoverTint = appTheme.purpleHoverTint;

  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, { duration: DURATION });
  }, [value]);

  useEffect(() => {
    hoverProgress.value = withTiming(hovered ? 1 : 0, { duration: HOVER_DURATION_MS });
  }, [hovered]);

  const boxStyle = useAnimatedStyle(() => {
    const checkedColor = interpolateColor(
      hoverProgress.value, [0, 1], [COLOR, PURPLE_HOVER_COLOR]);

    return {
      borderColor: interpolateColor(progress.value, [0, 1], [COLOR, checkedColor]),
      backgroundColor: interpolateColor(
        progress.value,
        [0, 1],
        [
          interpolateColor(hoverProgress.value, [0, 1], ['rgba(119, 0, 255, 0)', hoverTint]),
          checkedColor,
        ],
      ),
    };
  }, [hoverTint]);

  const checkStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: progress.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.box,
        boxStyle,
        style,
      ]}
    >
      <Animated.View style={checkStyle}>
        <FontAwesomeIcon
          icon={faCheck}
          size={SIZE - 4}
          color="white"
        />
      </Animated.View>
    </Animated.View>
  );
};

const CheckBoxLayout = ({
  children,
  value,
  labelPosition = 'right',
  containerStyle,
  onPress,
}: {
  children: React.ReactNode,
  value: boolean,
  labelPosition?: 'left' | 'right',
  containerStyle?: ViewStyle,
  onPress: () => void,
}) => {
  const gesture = useMemo(
    () => Gesture.Tap().onEnd(() => runOnJS(onPress)()),
    [onPress]
  );

  const { hovered, hoverProps } = useHover();

  const label = <DefaultText>{children}</DefaultText>;

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={{
          ...styles.container,
          ...containerStyle,
          ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
        }}
        {...hoverProps}
      >
        {labelPosition !== 'right' && label}
        <Box
          value={value}
          hovered={hovered}
          style={labelPosition === 'right' ? styles.boxLeft : styles.boxRight}
        />
        {labelPosition === 'right' && label}
      </View>
    </GestureDetector>
  );
};

const CheckBox = ({children, ...rest}: {
  children: React.ReactNode,
  initialValue?: boolean,
  value?: boolean,
  labelPosition?: 'left' | 'right',
  containerStyle?: ViewStyle,
  onValueChange?: (value: boolean) => void,
}) => {
  const {
    initialValue,
    value,
    labelPosition = 'right',
    containerStyle,
    onValueChange,
  } = rest;

  const [isChecked, setChecked] = useState(initialValue ?? value ?? false);

  if (value !== undefined && isChecked !== value)
    setChecked(value);

  const onPress = useCallback(() => {
    setChecked((v: boolean) => {
      const newV = !v;
      onValueChange && onValueChange(newV);
      return newV;
    });
  }, [onValueChange]);

  return (
    <CheckBoxLayout
      value={isChecked}
      labelPosition={labelPosition}
      containerStyle={containerStyle}
      onPress={onPress}
    >
      {children}
    </CheckBoxLayout>
  );
};

const StatelessCheckBox = ({children, ...rest}: {
  children: React.ReactNode,
  value: boolean,
  labelPosition?: 'left' | 'right',
  containerStyle?: ViewStyle,
  onValueChange: (value: boolean) => void,
}) => {
  const {
    value,
    labelPosition = 'right',
    containerStyle,
    onValueChange,
  } = rest;

  const onPress = useCallback(() => {
    onValueChange(!value);
  }, [onValueChange, value]);

  return (
    <CheckBoxLayout
      value={value}
      labelPosition={labelPosition}
      containerStyle={containerStyle}
      onPress={onPress}
    >
      {children}
    </CheckBoxLayout>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 5,
    marginTop: 15,
    marginBottom: 15,
  },
  box: {
    width: SIZE,
    height: SIZE,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLOR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxLeft: {
    marginRight: 8,
  },
  boxRight: {
    marginLeft: 8,
  },
});

export default CheckBox;
export { StatelessCheckBox };
