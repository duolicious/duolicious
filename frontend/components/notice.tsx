import {
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';
import { Pressable, PressableProps } from './pressable';
import {
  ReactNode,
  createElement
} from 'react';
import { useAppTheme } from '../app-theme/app-theme';

const Notice = ({children, onPress, style}: {
  children?: ReactNode,
  onPress?: () => void,
  style?: StyleProp<ViewStyle>,
}) => {

  const { appTheme } = useAppTheme();

  return (
    createElement<PressableProps>(
      onPress ? Pressable : View,
      {
        style: {
          width: '100%',
        },
        onPress: onPress,
      },
      <View
        style={[
          {
            backgroundColor: appTheme.avatarBackgroundColor,
            padding: 15,
            borderRadius: 10,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: 5,
            marginRight: 5,
          },
          style,
        ]}
      >
        {children}
      </View>
    )
  );
};

export {
  Notice,
};
