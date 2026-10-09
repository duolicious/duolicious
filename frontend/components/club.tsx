import {
  GestureResponderEvent,
  TextStyle,
  ViewStyle,
} from 'react-native';
import { Basic, Basics } from './basic';
import { DefaultText } from './default-text';
import { useAppTheme } from '../app-theme/app-theme';
import { RaisedChip } from './hover';

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
  onPress?: (e: GestureResponderEvent) => boolean | void,
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

const ClubFilter = ({
  name,
  isSelected,
  onPress,
}: {
  name: string | null,
  isSelected: boolean,
  onPress: (e: GestureResponderEvent) => void,
}) => {
  const { appTheme } = useAppTheme();

  return (
    <RaisedChip
      borderColor={isSelected ? '#5200b3' : appTheme.secondaryColor}
      style={{
        maxWidth: '100%',
        height: 34,
        paddingLeft: 12,
        paddingRight: 11,
        justifyContent: 'center',
        backgroundColor: isSelected ? '#7700ff' : appTheme.primaryColor,
      }}
      onPress={onPress}
    >
      <DefaultText
        numberOfLines={1}
        style={{
          fontFamily: name === null ? 'Trueno' : 'TruenoBold',
          fontWeight: name === null ? '400' : '900',
          fontSize: 15,
          color: isSelected ? '#ffffff' : appTheme.secondaryColor,
        }}
      >
        {name ?? 'Everyone'}
      </DefaultText>
    </RaisedChip>
  );
};

const Clubs = Basics;

export {
  Club,
  ClubFilter,
  Clubs,
};
