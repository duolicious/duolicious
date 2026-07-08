import { useIsFocused } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DefaultText } from './default-text';
import { HintBubble } from './hint-bubble';
import { useAppTheme } from '../app-theme/app-theme';

// A one-time callout pointing up at the inbox's search-filter button, teaching
// that the filters set on the search tab can be applied to intros here. The
// caller decides whether it should show (the seen-flag lives in
// `kv-storage/seen-inbox-filter-hint`) and marks it seen via `onDismiss`.
const InboxFilterHint = ({ onDismiss }: { onDismiss: () => void }) => {
  const { appTheme } = useAppTheme();
  const isFocused = useIsFocused();

  // Hidden (not dismissed) while another screen has focus, so it's still
  // there the next time the inbox is.
  if (!isFocused) {
    return null;
  }

  return (
    <HintBubble
      color={appTheme.brandColor}
      pointerPosition="right"
      style={{ right: -11, width: 240 }}
      onPress={onDismiss}
    >
      {(inkColor) => <>
        <Ionicons
          name="funnel-outline"
          style={{ color: inkColor, fontSize: 14 }}
        />
        <DefaultText
          style={{
            color: inkColor,
            fontSize: 13,
            flexShrink: 1,
            textAlign: 'center',
          }}
        >
          Tip: tap here to see intros that match your search filters first
        </DefaultText>
      </>}
    </HintBubble>
  );
};

export {
  InboxFilterHint,
};
