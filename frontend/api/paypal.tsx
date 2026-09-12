import { takeWebReturnParams } from './oauth-return';
import { Logo14 } from '../components/logo';
import { notifyIconToast } from '../components/toast';

const GOLD_TOAST_LABELS = new Map([
  ['subscribed', 'You now have Gold'],
  ['pending', 'Your PayPal subscription is being processed'],
]);

const showPendingPayPalResultToast = (): void => {
  const label = GOLD_TOAST_LABELS.get(
    takeWebReturnParams(['paypal'])?.get('paypal') ?? '');
  if (label) {
    notifyIconToast(label, () => <Logo14 size={24} color="#ffd700" />);
  }
};

export {
  showPendingPayPalResultToast,
};
