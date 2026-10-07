import { TextStyle, ViewStyle } from 'react-native';
import { Basic, Basics } from './basic';
import { useAppTheme } from '../app-theme/app-theme';

const Club = ({
  name,
  isMutual,
  style,
  textStyle,
  onPress,
}: {
  name: string,
  isMutual: boolean,
  style?: ViewStyle,
  textStyle?: TextStyle,
  onPress?: () => void,
}) => {
  const { appTheme } = useAppTheme();

  return (
    <Basic
      onPress={onPress}
      style={{
        borderBottomWidth: 3,
        ...(isMutual && {
          borderColor: textStyle?.color ?? appTheme.secondaryColor,
        }),
        ...style
      }}
      textStyle={{
        fontFamily: isMutual ? 'TruenoBold' : 'Trueno',
        fontWeight: isMutual ? '900' : '400',
        fontSize: 15,
        ...textStyle,
      }}
    >
      {name}
    </Basic>
  );
};

const Clubs = Basics;

export {
  Club,
  Clubs,
};
