import { Logo14 } from './logo';
import { notifyIconToast } from './toast';

const notifyGoldToast = (label: string) =>
  notifyIconToast(label, (color) => <Logo14 size={24} color={color} />, 6000);

export {
  notifyGoldToast,
};
