import 'react-native';

declare module 'react-native' {
  interface TextStyle {
    textWrap?: 'wrap' | 'nowrap' | 'balance' | 'pretty' | 'stable';
    whiteSpace?: 'normal' | 'nowrap';
    textOverflow?: 'clip' | 'ellipsis';
  }
}
