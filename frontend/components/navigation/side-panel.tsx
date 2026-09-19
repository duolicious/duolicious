import { ReactNode } from 'react';
import { View, ViewStyle } from 'react-native';
import { commonStyles } from '../../styles';
import { Surface, useAppTheme } from '../../app-theme/app-theme';
import { COLUMN_MAX_WIDTH } from '../../constants/constants';
import { isMobile } from '../../util/util';

const SIDE_PANEL_WIDTH = 320;
const SIDE_PANEL_GAP = 32;
const SIDE_PANEL_TOP = 20;

const sidePanelsMinWidth = (
  numPanels: number,
  columnWidth = COLUMN_MAX_WIDTH,
): number =>
  columnWidth + numPanels * (SIDE_PANEL_WIDTH + 2 * SIDE_PANEL_GAP);

const fitsSidePanels = (
  windowWidth: number,
  numPanels: number,
  columnWidth = COLUMN_MAX_WIDTH,
): boolean =>
  !isMobile() && windowWidth >= sidePanelsMinWidth(numPanels, columnWidth);

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

export {
  SIDE_PANEL_GAP,
  SIDE_PANEL_TOP,
  SIDE_PANEL_WIDTH,
  SidePanelCard,
  SidePanelHeading,
  fitsSidePanels,
  sidePanelsMinWidth,
};
