// eslint-disable-next-line no-restricted-imports
import { Pressable as ReactNativePressable } from 'react-native';
import type { PressableProps } from './pressable';

const Pressable = ({ link: _, ...props }: PressableProps) =>
  <ReactNativePressable {...props} />;

export {
  Pressable,
};
