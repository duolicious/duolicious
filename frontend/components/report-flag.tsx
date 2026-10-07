import { GestureResponderEvent, Pressable, ViewStyle } from 'react-native';
import { Flag } from 'react-native-feather';
import { useAppTheme } from '../app-theme/app-theme';
import { HoverCircle, useHover } from './hover';

const ReportFlag = ({ onPress, style }: {
  onPress: (event: GestureResponderEvent) => void
  style?: ViewStyle
}) => {
  const { appTheme } = useAppTheme();
  const { hovered, hoverProps } = useHover();

  return (
    <Pressable hitSlop={20} onPress={onPress} style={style} {...hoverProps}>
      <HoverCircle visible={hovered} />
      <Flag
        stroke={hovered ? appTheme.secondaryColor : `${appTheme.secondaryColor}80`}
        strokeWidth={2}
        height={18}
        width={18}
      />
    </Pressable>
  );
};

export {
  ReportFlag,
};
