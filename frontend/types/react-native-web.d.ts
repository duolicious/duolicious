import 'react-native';

declare module 'react-native' {
  interface TextStyle {
    textWrap?: 'wrap' | 'nowrap' | 'balance' | 'pretty' | 'stable';
  }
}
