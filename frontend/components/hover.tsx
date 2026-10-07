import {
  Platform,
  PointerEvent,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { useMemo, useState } from 'react';
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

const hoverColorFor = (color: string, appTheme: AppTheme): string => {
  if (color === appTheme.primaryColor) return appTheme.hoverColor;
  if (color === appTheme.brandColor) return appTheme.brandHoverColor;
  return FIXED_HOVER_COLORS[color] ?? color;
};

const riseStyle = (edgeColor: string): ViewStyle => ({
  transform: [{ translateY: -2 }],
  boxShadow: `0 2px 0 ${edgeColor}`,
});

const grabCursor = (grabbing: boolean): ViewStyle => {
  if (Platform.OS !== 'web') return {};
  // @ts-expect-error – React Native's types only allow the 'auto' and 'pointer' cursors
  return { cursor: grabbing ? 'grabbing' : 'grab' };
};

const HoverCircle = ({ visible, inset = -8 }: {
  visible: boolean
  inset?: number
}) => {
  const { appTheme } = useAppTheme();

  if (!visible) {
    return null;
  }

  return (
    <View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          top: inset,
          left: inset,
          right: inset,
          bottom: inset,
          borderRadius: 999,
          backgroundColor: appTheme.hoverOverlayColor,
        },
      ]}
    />
  );
};

export {
  HoverCircle,
  PURPLE_HOVER_COLOR,
  grabCursor,
  hoverColorFor,
  riseStyle,
  useHover,
};
