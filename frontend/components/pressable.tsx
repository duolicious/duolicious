import { Ref } from 'react';
import { View, ViewProps } from 'react-native';
// eslint-disable-next-line no-restricted-imports
import { Pressable as GestureHandlerPressable } from 'react-native-gesture-handler';

type Link = {
  href: string
  onOpenInNewTab?: () => void
};

type PressableProps = ViewProps & {
  disabled?: boolean
  link?: Link
  onPress?: () => void
  onPressIn?: () => void
  onPressOut?: () => void
  onHoverIn?: () => void
  onHoverOut?: () => void
  ref?: Ref<View>
};

const Pressable = ({ link: _, ...props }: PressableProps) =>
  <GestureHandlerPressable {...props} />;

export {
  Pressable,
  PressableProps,
};
