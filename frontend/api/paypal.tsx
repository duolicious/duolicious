import { japi } from './api';
import { takeWebReturnParams } from './oauth-return';
import { refreshProfileInfo } from '../events/profile-info';
import { Logo14 } from '../components/logo';
import { notifyIconToast } from '../components/toast';

const GOLD_TOAST_LABELS = new Map([
  ['subscribed', 'You now have Gold'],
  ['pending', 'Your PayPal subscription is being processed'],
]);

const notifyGoldToast = (label: string) =>
  notifyIconToast(label, (color) => <Logo14 size={24} color={color} />, 6000);

const showPendingPayPalResultToast = (): void => {
  const label = GOLD_TOAST_LABELS.get(
    takeWebReturnParams(['paypal'])?.get('paypal') ?? '');
  if (label) {
    notifyGoldToast(label);
  }
};

const cancelPaypalSubscription = async (): Promise<boolean> => {
  const { ok } = await japi('post', '/paypal/cancel');
  if (!ok) return false;
  await refreshProfileInfo();
  notifyGoldToast('Your Gold subscription is cancelled');
  return true;
};

export {
  cancelPaypalSubscription,
  showPendingPayPalResultToast,
};
