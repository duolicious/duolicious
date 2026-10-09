import {
  Keyboard,
  StyleSheet,
  TextInput,
} from 'react-native';
import { ComponentProps, Ref } from 'react';
import { useAppTheme } from '../app-theme/app-theme';

const DefaultTextInput = (props: ComponentProps<typeof TextInput> & { innerRef?: Ref<TextInput> }) => {
  const { style, innerRef, ...rest } = props;

  const { appTheme } = useAppTheme();

  return (
    <TextInput
      ref={innerRef}
      placeholder="Write here..."
      placeholderTextColor="#888"
      cursorColor="#70f"
      returnKeyType="done"
      onSubmitEditing={() => Keyboard.dismiss()}
      style={{
        color: appTheme.secondaryColor,
        backgroundColor: appTheme.inputColor,
        ...styles.textInput,
        ...style,
      }}
      {...rest}
    />
  );
};

const styles = StyleSheet.create({
  textInput: {
    padding: 10,
    marginLeft: 20,
    marginRight: 20,
    textAlignVertical: 'center',
    borderRadius: 10,
    height: 50,
    fontFamily: 'MontserratRegular',
    fontSize: 16,
  },
});

export {
  DefaultTextInput,
  styles,
};
