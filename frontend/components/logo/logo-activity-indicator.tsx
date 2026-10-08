import { Logo16 } from '.';
import { Logo16Props } from './common';

type LogoActivityIndicatorProps = Pick<Logo16Props, 'size' | 'color' | 'style'>;

// Drop-in replacement for ActivityIndicator. The fade delays are zeroed so the
// logo pulses continuously; otherwise it would sit on the fully-visible and
// fully-hidden frames for a moment, which reads as the spinner freezing.
const LogoActivityIndicator = ({
  size = 'large',
  color,
  style,
}: LogoActivityIndicatorProps) => (
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

export { LogoActivityIndicator };
