import { api, japi } from '../api/api';
import { navigateAway, webReturnTarget } from '../api/oauth-return';
import { Offering, OfferingInterval, PurchaseResult, monthsIn } from './offering';

type Plan = {
  id: string,
  price: string,
  currency: string,
  cycle: OfferingInterval,
  trial: OfferingInterval | null,
};

const purchase = async (planId: string): Promise<PurchaseResult> => {
  const response = await japi<{ approve_url: string }>(
    'post',
    '/paypal/subscribe',
    { redirect_target: webReturnTarget(), plan_id: planId },
  );

  if (response.status === 409) {
    return 'purchased';
  }

  if (!response.ok || !response.json) {
    return 'failed';
  }

  await navigateAway(response.json.approve_url);

  return 'cancelled';
};

const formatPrice = (amount: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency })
    .format(amount);

const getOffering = async (): Promise<Offering | null> => {
  const response = await api<Plan[]>('get', '/paypal/plans');
  if (!response.ok || !response.json?.length) return null;
  return {
    purchasables: response.json.map(({ id, price, currency, cycle, trial }) => ({
      price: formatPrice(Number(price), currency),
      pricePerMonth: formatPrice(Number(price) / monthsIn(cycle), currency),
      cycle,
      trial,
      purchase: () => purchase(id),
    })),
  };
};

export {
  getOffering,
};
