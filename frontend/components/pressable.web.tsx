import {
  GestureResponderEvent,
  // eslint-disable-next-line no-restricted-imports
  Pressable as ReactNativePressable,
} from 'react-native';
import type { PressableProps } from './pressable';

declare module 'react-native' {
  interface PressableProps {
    href?: string
    onAuxClick?: (event: { button: number }) => void
  }
}

const opensNewTab = ({ nativeEvent }: GestureResponderEvent) =>
  ('ctrlKey' in nativeEvent && nativeEvent.ctrlKey === true) ||
  ('metaKey' in nativeEvent && nativeEvent.metaKey === true) ||
  ('shiftKey' in nativeEvent && nativeEvent.shiftKey === true);

const Pressable = ({ link, onPress, ...props }: PressableProps) =>
  <ReactNativePressable
    {...props}
    href={link?.href}
    onPress={onPress && ((event) => {
      if (link && opensNewTab(event)) {
        link.onOpenInNewTab?.();
        return;
      }

      event.preventDefault();
      onPress();
    })}
    onAuxClick={link && (({ button }) => {
      if (button === 1) {
        link.onOpenInNewTab?.();
      }
    })}
  />;

export {
  Pressable,
};
