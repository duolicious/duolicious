import { Easing } from 'react-native-reanimated';

const DURATION_MS = 280;
const EASING = Easing.bezier(0.33, 0, 0.15, 1);
const TIMING = { duration: DURATION_MS, easing: EASING };

export {
  TIMING,
};
