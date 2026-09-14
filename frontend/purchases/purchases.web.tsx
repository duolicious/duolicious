import { api, japi } from '../api/api';
import { navigateAway, webReturnTarget } from '../api/oauth-return';
import { Offering, OfferingInterval, PurchaseResult } from './offering';

const DESCRIPTION = `
• Read receipts
• 100 club slots
• Dark mode & custom themes
• Extra privacy settings
• Update your display name
• Special Gold badge on your profile
`.trim();

type Plan = {
  id: string,
  product_name: string,
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

const formatPrice = (price: string, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency })
    .format(Number(price));

const getOffering = async (): Promise<Offering | null> => {
  const response = await api<Plan[]>('get', '/paypal/plans');
  const [plan] = response.json ?? [];
  if (!response.ok || !plan) return null;
  return {
    product_name: plan.product_name,
    description: DESCRIPTION,
    purchasables: response.json.map(({ id, price, currency, cycle, trial }) => ({
      price: formatPrice(price, currency),
      amount: Number(price),
      cycle,
      trial,
      purchase: () => purchase(id),
    })),
  };
};

export {
  getOffering,
};
