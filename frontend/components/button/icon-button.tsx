import { ReactNode } from 'react';
import { ViewStyle } from 'react-native';
import { Pressable } from '../pressable';
import { HoverCircle, useHover } from '../hover';

const IconButton = ({
  onPress,
  label,
  style,
  padding = 0,
  hoverColor,
  children,
}: {
  onPress: () => void,
  label?: string,
  style?: ViewStyle,
  padding?: number,
  hoverColor?: string,
  children: ReactNode,
}) => {
  const { hovered, hoverProps } = useHover();

  return (
    <Pressable
      aria-label={label}
      onPress={onPress}
      style={[{ padding }, style]}
      {...hoverProps}
    >
      <HoverCircle
        visible={hovered}
        inset={padding - 8}
        color={hoverColor}
      />
      {children}
    </Pressable>
  );
};

export {
  IconButton,
};
