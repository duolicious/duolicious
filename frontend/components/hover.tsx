import {
  Platform,
  PointerEvent,
  Pressable,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { useMemo, useState } from 'react';
import Animated, { CSSTransitionProperties } from 'react-native-reanimated';
import { AppTheme, useAppTheme } from '../app-theme/app-theme';

const PURPLE_HOVER_COLOR = '#6400d6';

const FIXED_HOVER_COLORS: Record<string, string> = {
  '#70f': PURPLE_HOVER_COLOR,
  '#7700ff': PURPLE_HOVER_COLOR,
  'black': '#2b2b2b',
  '#000000': '#2b2b2b',
};

const useHover = () => {
  const [hovered, setHovered] = useState(false);

  const hoverProps = useMemo(() => ({
    onPointerEnter: (e: PointerEvent) => {
      if (e.nativeEvent.pointerType !== 'touch') {
        setHovered(true);
      }
    },
    onPointerLeave: () => setHovered(false),
  }), []);

  return { hovered, hoverProps };
};

const usePressed = () => {
  const [pressed, setPressed] = useState(false);

  const pressProps = useMemo(() => ({
    onPressIn: () => setPressed(true),
    onPressOut: () => setPressed(false),
  }), []);

  return { pressed, pressProps };
};

const hoverColorFor = (color: string, appTheme: AppTheme): string => {
  if (color === appTheme.primaryColor) return appTheme.hoverColor;
  if (color === appTheme.brandColor) return appTheme.brandHoverColor;
  return FIXED_HOVER_COLORS[color] ?? color;
};

const HOVER_DURATION_MS = 150;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const hoverTransition = (
  properties: CSSTransitionProperties['transitionProperty'],
): CSSTransitionProperties => ({
  transitionProperty: properties,
  transitionDuration: HOVER_DURATION_MS,
  transitionTimingFunction: 'ease-out',
});

const riseStyle = (
  raised: boolean,
  borderBottomWidth: number,
  marginTop = 0,
): ViewStyle => ({
  marginTop: marginTop - (raised ? 2 : 0),
  borderBottomWidth: borderBottomWidth + (raised ? 2 : 0),
});

const riseTransition = (pressed: boolean) =>
  hoverTransition(pressed ? 'none' : ['marginTop', 'borderBottomWidth']);

const grabCursor = (grabbing: boolean): ViewStyle => {
  if (Platform.OS !== 'web') return {};
  // @ts-expect-error – React Native's types only allow the 'auto' and 'pointer' cursors
  return { cursor: grabbing ? 'grabbing' : 'grab' };
};

const HoverCircle = ({ visible, inset = -8, insetX = inset }: {
  visible: boolean
  inset?: number
  insetX?: number
}) => {
  const { appTheme } = useAppTheme();

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          top: inset,
          left: insetX,
          right: insetX,
          bottom: inset,
          borderRadius: 999,
          backgroundColor: appTheme.hoverOverlayColor,
          opacity: visible ? 1 : 0,
          transform: [{ scale: visible ? 1 : 0.8 }],
        },
        hoverTransition(['opacity', 'transform']),
      ]}
    />
  );
};

export {
  AnimatedPressable,
  HOVER_DURATION_MS,
  HoverCircle,
  PURPLE_HOVER_COLOR,
  grabCursor,
  hoverColorFor,
  hoverTransition,
  riseStyle,
  riseTransition,
  useHover,
  usePressed,
};
