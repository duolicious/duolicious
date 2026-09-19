import { ReactNode, useEffect, useState } from 'react';
import { Dimensions, StyleSheet, View, ViewStyle } from 'react-native';
import { commonStyles } from '../../styles';
import { Surface, useAppTheme } from '../../app-theme/app-theme';
import { COLUMN_MAX_WIDTH } from '../../constants/constants';
import { isMobile } from '../../util/util';

const SIDE_PANEL_WIDTH = 320;
const SIDE_PANEL_GAP = 32;
const SIDE_PANEL_TOP = 20;

const SIDE_PANEL_SPACE = SIDE_PANEL_WIDTH + 2 * SIDE_PANEL_GAP;

const fitsSidePanels = (
  windowWidth: number,
  numPanels: number,
  minColumnWidth: number,
): boolean =>
  !isMobile() && windowWidth >= minColumnWidth + numPanels * SIDE_PANEL_SPACE;

const useFitsSidePanels = (
  numPanels: number,
  minColumnWidth = COLUMN_MAX_WIDTH,
): boolean => {
  const fits =
    fitsSidePanels(Dimensions.get('window').width, numPanels, minColumnWidth);
  const [, setFits] = useState(fits);

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) =>
      setFits(fitsSidePanels(window.width, numPanels, minColumnWidth)));
    return () => subscription.remove();
  }, [numPanels, minColumnWidth]);

  return fits;
};

const SidePanelLayout = ({ left, right, style, children }: {
  left?: ReactNode
  right?: ReactNode
  style?: ViewStyle
  children: ReactNode
}) =>
  <View style={[styles.row, style]} pointerEvents="box-none">
    <View
      style={[styles.space, !!left && styles.panelSpace]}
      pointerEvents="box-none"
    >
      {left &&
        <View style={[styles.panel, styles.leftPanel]} pointerEvents="box-none">
          {left}
        </View>
      }
    </View>
    <View style={styles.column} pointerEvents="box-none">
      {children}
    </View>
    <View
      style={[styles.space, !!right && styles.panelSpace]}
      pointerEvents="box-none"
    >
      {right &&
        <View style={[styles.panel, styles.rightPanel]} pointerEvents="box-none">
          {right}
        </View>
      }
    </View>
  </View>;

const SidePanelCard = ({ style, surface, children }: {
  style?: ViewStyle
  surface?: Surface
  children: ReactNode
}) => {
  const { appTheme } = useAppTheme();

  const colors = surface
    ? {
        backgroundColor: surface.backgroundColor,
        borderTopColor: surface.borderColor,
        borderLeftColor: surface.borderColor,
        borderRightColor: surface.borderColor,
        borderBottomColor: surface.borderColor,
      }
    : { backgroundColor: appTheme.primaryColor, ...appTheme.card };

  return (
    <View
      style={{
        overflow: 'hidden',
        ...commonStyles.cardBorders,
        ...colors,
        ...style,
      }}
    >
      {children}
    </View>
  );
};

const SidePanelHeading = ({ children, isFirst, color }: {
  children: ReactNode
  isFirst?: boolean
  color?: string
}) => {
  const { appTheme } = useAppTheme();

  return (
    <h2
      style={{
        margin: 0,
        color: color ?? appTheme.secondaryColor,
        fontFamily: 'MontserratBlack',
        fontWeight: 'normal',
        fontSize: 18,
        padding: `${isFirst ? 14 : 32}px 16px 6px`,
      }}
    >
      {children}
    </h2>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  space: {
    flex: 1,
  },
  panelSpace: {
    minWidth: SIDE_PANEL_SPACE,
  },
  column: {
    flexBasis: COLUMN_MAX_WIDTH,
    flexShrink: 1,
  },
  panel: {
    position: 'absolute',
    top: SIDE_PANEL_TOP,
    bottom: SIDE_PANEL_TOP,
    width: SIDE_PANEL_WIDTH,
  },
  leftPanel: {
    right: SIDE_PANEL_GAP,
  },
  rightPanel: {
    left: SIDE_PANEL_GAP,
  },
});

export {
  SIDE_PANEL_TOP,
  SIDE_PANEL_WIDTH,
  SidePanelCard,
  SidePanelHeading,
  SidePanelLayout,
  useFitsSidePanels,
};
