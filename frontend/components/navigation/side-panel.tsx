import { ReactNode } from 'react';
import { View, ViewStyle } from 'react-native';
import { commonStyles } from '../../styles';
import { useAppTheme } from '../../app-theme/app-theme';

const SidePanelCard = ({ style, children }: {
  style?: ViewStyle
  children: ReactNode
}) => {
  const { appTheme } = useAppTheme();

  return (
    <View
      style={{
        overflow: 'hidden',
        backgroundColor: appTheme.primaryColor,
        ...commonStyles.cardBorders,
        ...appTheme.card,
        ...style,
      }}
    >
      {children}
    </View>
  );
};

const SidePanelHeading = ({ children, isFirst }: {
  children: ReactNode
  isFirst?: boolean
}) => {
  const { appTheme } = useAppTheme();

  return (
    <h2
      style={{
        margin: 0,
        color: appTheme.secondaryColor,
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
