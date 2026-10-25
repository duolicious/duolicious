import {
  Keyboard,
  Platform,
  View,
  ViewProps,
} from 'react-native';

const KeyboardDismissingView = (
  { enabled = true, ...rest }: ViewProps & { enabled?: boolean }
) =>
  <View
    onStartShouldSetResponder={() => enabled && Platform.OS !== 'web'}
    onResponderRelease={Keyboard.dismiss}
    {...rest}
  />;

export {
  KeyboardDismissingView,
};
