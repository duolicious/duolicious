import { GestureResponderEvent } from 'react-native';

const makeLinkProps = (link: string) => {
  return {
    href: link
  };
};

const isOpenInNewTabPress = ({ nativeEvent }: GestureResponderEvent) =>
  ('ctrlKey' in nativeEvent && nativeEvent.ctrlKey === true) ||
  ('metaKey' in nativeEvent && nativeEvent.metaKey === true) ||
  ('shiftKey' in nativeEvent && nativeEvent.shiftKey === true);

export {
  isOpenInNewTabPress,
  makeLinkProps,
};
