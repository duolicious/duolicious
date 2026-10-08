import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Logo16 } from '.';
import { Logo16Props, resolveLogoSize } from './common';

type LogoActivityIndicatorProps = Pick<Logo16Props, 'size' | 'color' | 'style'> & {
  delay?: number
};

// Drop-in replacement for ActivityIndicator. The fade delays are zeroed so the
// logo pulses continuously; otherwise it would sit on the fully-visible and
// fully-hidden frames for a moment, which reads as the spinner freezing.
const LogoActivityIndicator = ({
  size = 'large',
  color,
  style,
  delay = 0,
}: LogoActivityIndicatorProps) => {
  const [isShown, setIsShown] = useState(delay === 0);

  useEffect(() => {
    if (isShown) return;

    const timer = setTimeout(() => setIsShown(true), delay);
    return () => clearTimeout(timer);
  }, []);

  if (!isShown) {
    const sizePx = resolveLogoSize(size);
    return <View style={[{ width: sizePx, height: sizePx }, style]} />;
  }

  return (
    <Logo16
      size={size}
      color={color}
      style={style}
      doAnimate={true}
      startVisible={true}
      fadeInDelay={0}
      fadeOutDelay={0}
    />
  );
};

export { LogoActivityIndicator };
