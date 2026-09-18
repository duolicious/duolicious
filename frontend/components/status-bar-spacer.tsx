import { Platform, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const STATUS_BAR_SPACER_EXTRA_HEIGHT = Platform.OS === 'ios' ? 0 : 10;

const StatusBarSpacer = (props: { extraHeight?: number, style?: ViewStyle }) => {
  const insets = useSafeAreaInsets();
  const extraHeight = props.extraHeight ?? STATUS_BAR_SPACER_EXTRA_HEIGHT;

  return (
    <View
      style={{
        height: extraHeight + (Platform.OS === 'web' ? 0 : insets.top),
        backgroundColor: 'transparent',
        ...props.style,
      }}
    />
  );
};

export {
  STATUS_BAR_SPACER_EXTRA_HEIGHT,
  StatusBarSpacer,
}
