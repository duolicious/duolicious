import SelectableText from 'selectable-text';
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
  <SelectableText
    text={about}
    color={color}
    fontFamily={defaultFontFamily}
    fontSize={defaultFontSize}
    onSelectionChange={onSelectionChange &&
      ((e) => onSelectionChange(e.nativeEvent))}
  />
);

export {
  NativeAboutText,
};
