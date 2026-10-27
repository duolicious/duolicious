import { useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

const useIsScrolled = () => {
  const [isScrolled, setIsScrolled] = useState(false);

  const onScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) =>
    setIsScrolled(nativeEvent.contentOffset.y > 0);

  return { isScrolled, onScroll };
};

export {
  useIsScrolled,
};
