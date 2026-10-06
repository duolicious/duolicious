import { StyleProp, ViewStyle } from 'react-native';

type LogoSizeStrings = 'large' | 'medium' | 'small'

type LogoSize = number | LogoSizeStrings;

// Sizes are multiples of 16 (the logo's grid resolution) so each cell maps to a
// whole number of pixels and stays crisp on low-dpi displays.
const LOGO_SIZE_PX: Record<LogoSizeStrings, number> = {
  large: 48,
  medium: 32,
  small: 16,
};

const resolveLogoSize = (size: LogoSize): number =>
  typeof size === 'number' ? size : LOGO_SIZE_PX[size];

type Logo14Props = {
  size?: number,
  color?: string,
  rectSize?: number,
};

type Logo16Props = {
  size?: LogoSize;
  color?: string;
  rectSize?: number;
  fadeOutDelay?: number;
  fadeInDelay?: number;
  doAnimate?: boolean;
  doLoop?: boolean;
  startVisible?: boolean;
  style?: StyleProp<ViewStyle>;
};

const LOGO_16_RECT_COORDINATES = [
  { x: 1.5875,     y: 1.5875    },
  { x: 1.3229166,  y: 1.5875    },
  { x: 1.0583335,  y: 1.8520836 },
  { x: 0.79375011, y: 1.5875    },
  { x: 0.52916676, y: 1.5875    },
  { x: 0.26458347, y: 1.8520836 },
  { x: 0.26458347, y: 2.1166666 },
  { x: 0.52916676, y: 2.3812499 },
  { x: 0.79375011, y: 2.6458333 },
  { x: 1.0583335,  y: 2.9104166 },
  { x: 1.3229166,  y: 2.6458333 },
  { x: 1.5875,     y: 2.3812499 },
  { x: 1.8520833,  y: 2.1166666 },
  { x: 1.8520833,  y: 1.8520836 },
  { x: 2.1166666,  y: 1.5875    },
  { x: 2.1166666,  y: 1.3229166 },
  { x: 2.3812499,  y: 1.0583333 },
  { x: 2.6458333,  y: 1.0583333 },
  { x: 2.9104166,  y: 1.3229166 },
  { x: 3.175,      y: 1.0583333 },
  { x: 3.4395833,  y: 1.0583333 },
  { x: 3.7041664,  y: 1.3229166 },
  { x: 3.7041664,  y: 1.5875    },
  { x: 3.4395833,  y: 1.8520833 },
  { x: 3.175,      y: 2.1166666 },
  { x: 2.9104166,  y: 2.3812499 },
  { x: 2.6458333,  y: 2.1166666 },
  { x: 2.3812499,  y: 1.8520833 },
];

export {
  Logo14Props,
  Logo16Props,
  LogoSize,
  LOGO_16_RECT_COORDINATES,
  resolveLogoSize,
}
