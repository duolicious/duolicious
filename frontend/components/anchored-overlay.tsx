import { ReactNode, useCallback, useRef, useState } from 'react';
import {
  Modal,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

type AnchorMeasurement = {
  x: number,
  y: number,
  width: number,
  height: number,
  pageX: number,
  pageY: number,
};

type WindowDimensions = {
  width: number,
  height: number,
};

const DEFAULT_EDGE_PADDING = 8;

const useAnchorMeasurement = () => {
  const anchorRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<AnchorMeasurement>();

  const measureAnchor = useCallback((
    callback?: (measurement: AnchorMeasurement) => void,
  ) => {
    anchorRef.current?.measure((x, y, width, height, pageX, pageY) => {
      const measurement = { x, y, width, height, pageX, pageY };

      setAnchor(measurement);
      callback?.(measurement);
    });
  }, []);

  return {
    anchor,
    anchorRef,
    measureAnchor,
  };
};

const aboveAnchorStyle = (
  anchor: AnchorMeasurement | undefined,
  windowDimensions: WindowDimensions,
  {
    estimatedWidth,
    estimatedHeight,
    gap = 6,
    edgePadding = DEFAULT_EDGE_PADDING,
  }: {
    estimatedWidth: number,
    estimatedHeight: number,
    gap?: number,
    edgePadding?: number,
  },
): ViewStyle => ({
  position: 'absolute',
  left: Math.max(
    edgePadding,
    Math.min(
      anchor?.pageX ?? edgePadding,
      windowDimensions.width - estimatedWidth - edgePadding,
    ),
  ),
  top: Math.max(
    edgePadding,
    (anchor?.pageY ?? estimatedHeight) - estimatedHeight - gap,
  ),
});

const tooltipAnchorStyle = (
  anchor: AnchorMeasurement,
  windowDimensions: WindowDimensions,
): ViewStyle => {
  const horizontalDirection: 'left' | 'right' =
    anchor.pageX > windowDimensions.width / 2
    ? 'left'
    : 'right';

  return {
    position: 'absolute',

    ...(horizontalDirection === 'right' ? {
      left: anchor.pageX,
      paddingLeft: Math.max(0, anchor.width - 4),
    } : {
      right: windowDimensions.width - anchor.pageX - anchor.width,
      paddingRight: Math.max(0, anchor.width - 4),
    }),

    top: anchor.pageY,
    paddingTop: Math.max(0, anchor.height - 4),
  };
};

const AnchoredOverlay = ({
  visible,
  modal = false,
  onRequestClose,
  overlayProps,
  children,
}: {
  visible: boolean,
  modal?: boolean,
  onRequestClose?: () => void,
  overlayProps?: object,
  children: ReactNode,
}) => {
  if (!visible) {
    return null;
  }

  const content = (
    <View
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
      }}
      {...overlayProps}
    >
      {children}
    </View>
  );

  if (!modal) {
    return content;
  }

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={onRequestClose}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        {content}
      </GestureHandlerRootView>
    </Modal>
  );
};

const useWindowOverlayDimensions = (): WindowDimensions => {
  const { width, height } = useWindowDimensions();

  return { width, height };
};

export {
  AnchorMeasurement,
  AnchoredOverlay,
  aboveAnchorStyle,
  tooltipAnchorStyle,
  useAnchorMeasurement,
  useWindowOverlayDimensions,
};
