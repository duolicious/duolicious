import {
  codegenNativeComponent,
  type ColorValue,
  type HostComponent,
  type ViewProps,
} from 'react-native';
import type {
  DirectEventHandler,
  Float,
  Int32,
} from 'react-native/Libraries/Types/CodegenTypes';

type SelectionChangeEvent = Readonly<{
  start: Int32;
  end: Int32;
}>;

interface NativeProps extends ViewProps {
  text: string;
  color?: ColorValue;
  fontFamily: string;
  fontSize: Float;
  onSelectionChange?: DirectEventHandler<SelectionChangeEvent>;
}

export default codegenNativeComponent<NativeProps>('DuoSelectableText', {
  interfaceOnly: true,
  excludedPlatforms: ['iOS'],
}) as HostComponent<NativeProps>;
