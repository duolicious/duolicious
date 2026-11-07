import { TextInput } from 'react-native';
import { defaultFontFamily, defaultFontSize } from '../default-text';
import type { TextSelection } from '../conversation-screen/quote';

const NativeAboutText = ({
  about,
  color,
  onSelectionChange,
}: {
  about: string,
  color: string,
  onSelectionChange?: (selection: TextSelection) => void,
}) => (
  <TextInput
    value={about}
    multiline={true}
    scrollEnabled={false}
    editable={false}
    onSelectionChange={onSelectionChange &&
      ((e) => onSelectionChange(e.nativeEvent.selection))}
    style={{
      color,
      fontFamily: defaultFontFamily,
      fontSize: defaultFontSize,
      padding: 0,
      margin: 0,
    }}
  />
);

export {
  NativeAboutText,
};
