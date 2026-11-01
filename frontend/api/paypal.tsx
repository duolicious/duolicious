import { japi } from './api';
import { takeWebReturnParams } from './oauth-return';
import { refreshProfileInfo } from '../events/profile-info';
import { SomethingWentWrongToast } from '../components/toast';
import { notifyGoldToast } from '../components/gold-toast';
import { notify } from '../events/events';

const GOLD_TOAST_LABELS = new Map([
  ['subscribed', 'You now have Gold'],
  ['pending', 'Your PayPal subscription is being processed'],
]);

const showPendingPayPalResultToast = (): void => {
  const label = GOLD_TOAST_LABELS.get(
    takeWebReturnParams(['paypal'])?.get('paypal') ?? '');
  if (label) {
    notifyGoldToast(label);
  }
};

const cancelPaypalSubscription = async (): Promise<boolean> => {
  const { ok } = await japi('post', '/paypal/cancel');
  if (!ok) {
    notify<React.FC>('toast', SomethingWentWrongToast);
    return false;
  }
  await refreshProfileInfo();
  notifyGoldToast('Your Gold subscription is cancelled');
  return true;
};

export {
  cancelPaypalSubscription,
  showPendingPayPalResultToast,
};
