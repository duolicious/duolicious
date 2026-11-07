import { ReactNode } from 'react';
import { View, ViewStyle } from 'react-native';
import { X } from "react-native-feather";
import { useAppTheme } from '../../app-theme/app-theme';
import { IconButton } from './icon-button';

const SIZE = 24;

const Close = ({
  onPress,
  style,
  color,
}: {
  onPress: () => void,
  style?: ViewStyle,
  color?: string,
}) => {
  const { appTheme } = useAppTheme();

  return (
    <IconButton
      onPress={onPress}
      style={style}
    >
      <X
        stroke={color ?? appTheme.secondaryColor}
        strokeWidth={3}
        height={SIZE}
        width={SIZE}
      />
    </IconButton>
  );
};

const HeaderWithClose = ({
  onPress,
  color,
  children,
}: {
  onPress: () => void,
  color?: string,
  children: ReactNode,
}) => {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        alignSelf: 'stretch',
      }}
    >
      <View style={{ width: SIZE }} />
      <View style={{ flex: 1, alignItems: 'center' }}>
        {children}
      </View>
      <Close onPress={onPress} color={color} />
    </View>
  );
};

export {
  Close,
  HeaderWithClose,
};
