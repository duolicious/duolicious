import {
  GestureResponderEvent,
  Platform,
  PointerEvent,
  Pressable,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { ReactNode, useMemo, useState } from 'react';
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

const RISE_PX = 2;

const riseStyle = (raised: boolean): ViewStyle => ({
  top: raised ? -RISE_PX : 0,
});

const RiseEdge = ({ raised, pressed, color, border }: {
  raised: boolean
  pressed: boolean
  color: string
  border: { top: number, right: number, bottom: number, left: number }
}) => {
  const lift = raised ? RISE_PX : 0;

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          top: lift - border.top,
          right: -border.right,
          bottom: -border.bottom - lift,
          left: -border.left,
          borderRadius: 999,
          borderBottomWidth: border.bottom + lift,
          borderColor: color,
          opacity: raised ? 1 : 0,
        },
        hoverTransition(
          pressed ? 'none' : ['top', 'bottom', 'borderBottomWidth', 'opacity']),
      ]}
    />
  );
};

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

const RaisedChip = ({ borderColor, style, onPress, children }: {
  borderColor: string
  style: ViewStyle
  onPress: (e: GestureResponderEvent) => void
  children: ReactNode
}) => {
  const { hovered, hoverProps } = useHover();
  const { pressed, pressProps } = usePressed();
  const raised = hovered && !pressed;

  return (
    <AnimatedPressable
      onPress={onPress}
      {...hoverProps}
      {...pressProps}
      style={[
        {
          borderRadius: 999,
          borderWidth: 1,
          borderRightWidth: 2,
          borderBottomWidth: 4,
          borderColor,
        },
        style,
        riseStyle(raised),
        hoverTransition(pressed ? 'none' : 'top'),
      ]}
    >
      <RiseEdge
        raised={raised}
        pressed={pressed}
        color={borderColor}
        border={{ top: 1, right: 2, bottom: 4, left: 1 }}
      />
      {children}
    </AnimatedPressable>
  );
};

export {
  AnimatedPressable,
  HOVER_DURATION_MS,
  HoverCircle,
  PURPLE_HOVER_COLOR,
  RaisedChip,
  RiseEdge,
  grabCursor,
  hoverColorFor,
  hoverTransition,
  riseStyle,
  useHover,
  usePressed,
};
