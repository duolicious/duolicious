import { useIsFocused } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DefaultText } from '../default-text';
import { HintBubble } from './hint-bubble';
import { useAppTheme } from '../../app-theme/app-theme';

// A one-time callout pointing up at the search tab's filters button, showing
// new users where to narrow down who they see. The caller decides whether it
// should show (the seen-flag lives in `kv-storage/seen-hints/
// seen-search-filters-hint`) and marks it seen via `onDismiss`.
const SearchFiltersHint = ({ onDismiss }: { onDismiss: () => void }) => {
  const { appTheme } = useAppTheme();
  const isFocused = useIsFocused();

  // Hidden (not dismissed) while another screen has focus, so it's still
  // there the next time the search tab is.
  if (!isFocused) {
    return null;
  }

  return (
    <HintBubble
      color={appTheme.brandColor}
      pointerPosition="right"
      style={{ right: -3, width: 240 }}
      onPress={onDismiss}
    >
      {(inkColor) => <>
        <Ionicons
          name="options-outline"
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
          Set your search filters here to find better matches
        </DefaultText>
      </>}
    </HintBubble>
  );
};

export {
  SearchFiltersHint,
};
