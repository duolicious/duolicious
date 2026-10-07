import { useEffect, useState, useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  LayoutChangeEvent,
  ViewStyle,
  TextStyle,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { DefaultText } from './default-text';


const DURATION = 250;

type ButtonGroupProps = {
  buttons: string[];
  selectedIndex: number;
  onPress: (index: number) => void;
  containerStyle?: ViewStyle;
  textStyle?: TextStyle;
  secondary?: boolean;
  disabled?: boolean;
};

const ButtonGroup: React.FC<ButtonGroupProps> = ({
  buttons,
  selectedIndex,
  onPress,
  containerStyle,
  textStyle,
  secondary = false,
  disabled = false,
}) => {
  // layouts for indicator
  const [layouts, setLayouts] = useState<{ x: number; width: number }[]>(
    () => Array.from({ length: buttons.length }, () => ({ x: 0, width: 0 }))
  );
  const indicatorX = useSharedValue(0);
  const indicatorW = useSharedValue(0);
  const hasLaidOutInitial = useRef(false);

  // shared value for fade
  const opacity = useSharedValue(disabled ? 0 : 1);

  // animate indicator on select/layout change
  useEffect(() => {
    const { x, width } = layouts[selectedIndex] || { x: 0, width: 0 };
    if (width <= 0) return;

    if (hasLaidOutInitial.current) {
      indicatorX.value = withTiming(x, { duration: DURATION });
      indicatorW.value = withTiming(width, { duration: DURATION });
    } else {
      indicatorX.value = x;
      indicatorW.value = width;
      hasLaidOutInitial.current = true;
    }
  }, [selectedIndex, layouts]);

  // animate opacity on disabled change
  useEffect(() => {
    opacity.value = withTiming(disabled ? 0 : 1, { duration: DURATION });
  }, [disabled]);

  const animatedContainerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const animatedIndicatorStyle = useAnimatedStyle(() => ({
    width: indicatorW.value,
    opacity: indicatorW.value ? 1 : 0,
    transform: [{ translateX: indicatorX.value }],
  }));

  const onButtonLayout = (i: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setLayouts(old => {
      const next = [...old];
      next[i] = { x, width };
      return next;
    });
  };

  return (
    <Animated.View
      style={[
        styles.baseContainer,
        secondary ? styles.secondaryContainer : styles.primaryContainer,
        containerStyle,
        animatedContainerStyle,
      ]}
      pointerEvents={disabled ? 'none' : 'auto'}
    >
      {/* sliding highlight */}
      <Animated.View
        style={[
          styles.baseIndicator,
          secondary ? styles.secondaryIndicator : styles.primaryIndicator,
          animatedIndicatorStyle,
        ]}
      />

      {buttons.map((label, i) => {
        const isSelected = i === selectedIndex;
        return (
          <Pressable
            key={i}
            onPress={() => onPress(i)}
            onLayout={onButtonLayout(i)}
            style={styles.button}
          >
            <DefaultText
              style={{
                ...(secondary ? styles.secondaryLabel : styles.primaryLabel),
                ...textStyle,
                color: isSelected ? '#70f' : 'rgb(94, 105, 119)',
              }}
            >
              {label}
            </DefaultText>
          </Pressable>
        );
      })}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  baseContainer: {
    flexDirection: 'row',
    marginBottom: 10,
    overflow: 'visible',
  },
  primaryContainer: {
    height: 48,
  },
  secondaryContainer: {
    height: 34,
  },
  baseIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgb(228, 204, 255)',
    borderColor: '#70f',
    borderWidth: 1,
    borderBottomWidth: 3,
  },
  primaryIndicator: {
    borderRadius: 18,
  },
  secondaryIndicator: {
    borderRadius: 12,
  },
  button: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryLabel: {
    fontWeight: '500',
    fontSize: 14,
  },
  secondaryLabel: {
    fontWeight: '500',
    fontSize: 11,
  },
});

export { ButtonGroup };
