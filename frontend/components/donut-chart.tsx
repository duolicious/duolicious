import React from 'react';
import {
  Animated,
  Pressable,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import {
  useCallback,
  useRef,
} from 'react';
import { DefaultText } from './default-text';
import Svg, { Circle } from "react-native-svg";
import { useHover } from './hover';

const DonutChart = ({percentage, children, style, onPress, textStyle}: {
  percentage?: number,
  children?: React.ReactNode | ((hovered: boolean) => React.ReactNode),
  style?: ViewStyle,
  onPress?: () => void,
  textStyle?: TextStyle,
}) => {

  const size = 80;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = (percentage || 0) / 100.0;

  const opacity = useRef(new Animated.Value(1)).current;
  const { hovered, hoverProps } = useHover();

  const fadeOut = useCallback(() => {
    if (!onPress) return;
    opacity.setValue(0.4);
  }, []);

  const fadeIn = useCallback(() => {
    if (!onPress) return;
    Animated.timing(opacity, {
      toValue: 1,
      duration: 50,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    React.createElement(
      onPress ? Pressable : View,
      {
        style: {
          alignItems: "center",
          justifyContent: "center",
          ...style,
        },
        onPressIn: fadeOut,
        onPressOut: fadeIn,
        onPress: onPress,
        ...hoverProps,
        children: (
          <Animated.View style={{opacity: opacity}}>
            <Svg
              height={size}
              width={size}
              style={{
                transform: [{ rotateZ: '-90deg' }],
              }}
            >
              <Circle
               cx="50%"
               cy="50%"
               r={radius}
               stroke="#ccc"
               opacity={0.3}
               fill="transparent"
               strokeWidth={strokeWidth}
              />
              <Circle
               cx="50%"
               cy="50%"
               r={radius}
               stroke="#70f"
               fill="transparent"
               strokeWidth={strokeWidth * 0.8}
               strokeDasharray={circumference}
               strokeDashoffset={
                 Math.min(
                   circumference,
                   circumference * (1 - ratio) + strokeWidth / 2
                 )
               }
               strokeLinecap="round"
              />
            </Svg>
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                bottom: 0,
                right: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <DefaultText
                style={{
                  fontWeight: '600',
                  fontSize: 20,
                  ...textStyle,
                }}
              >
                {percentage === undefined && ""}
                {percentage !== undefined && `${percentage}%`}
              </DefaultText>
              {typeof children === 'function'
                ? children(hovered && !!onPress)
                : children}
            </View>
          </Animated.View>
        )
      }
    )
  );
};

export {
  DonutChart,
}
