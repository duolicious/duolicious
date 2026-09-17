import { ReactNode } from 'react';
import { View, ViewStyle } from 'react-native';
import { commonStyles } from '../../styles';
import { Surface, useAppTheme } from '../../app-theme/app-theme';

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
  SidePanelCard,
  SidePanelHeading,
};
