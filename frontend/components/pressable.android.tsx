// eslint-disable-next-line no-restricted-imports
import { Pressable as ReactNativePressable } from 'react-native';
import type { PressableProps } from './pressable';

// On Android, gesture-handler's button view ignores per-side border widths,
// doesn't clip its children to its border radius, and fires presses when a
// quick flick scrolls its parent list. iOS keeps gesture-handler's button
// (pressable.tsx) so that iOS 27 doesn't treat taps near the top of the screen
// as status-bar taps.
const Pressable = ({ link: _, ...props }: PressableProps) =>
  <ReactNativePressable {...props} />;

export {
  Pressable,
};
