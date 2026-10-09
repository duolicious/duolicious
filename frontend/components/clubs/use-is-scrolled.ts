import { useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

const useIsScrolled = (resetKey = '') => {
  const [scrolledKey, setScrolledKey] = useState<string | null>(null);

  const onScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) =>
    setScrolledKey(nativeEvent.contentOffset.y > 0 ? resetKey : null);

  return { isScrolled: scrolledKey === resetKey, onScroll };
};

export {
  useIsScrolled,
};
