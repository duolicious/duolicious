import { Pressable, ViewStyle } from 'react-native';
import { X } from "react-native-feather";
import { useAppTheme } from '../../app-theme/app-theme';
import { HoverCircle, useHover } from '../hover';

const Close = ({
  onPress,
  style = { top: 10, right: 10 },
  color,
}: {
  onPress: () => void,
  style?: ViewStyle | null,
  color?: string,
}) => {
  const { appTheme } = useAppTheme();
  const { hovered, hoverProps } = useHover();

  return (
    <Pressable
      onPress={onPress}
      style={{
        position: 'absolute',
        zIndex: 1,
        ...style,
      }}
      {...hoverProps}
    >
      <HoverCircle visible={hovered} />
      <X
        stroke={color ?? appTheme.secondaryColor}
        strokeWidth={3}
        height={24}
        width={24}
      />
    </Pressable>
  );
};

export {
  Close,
};
