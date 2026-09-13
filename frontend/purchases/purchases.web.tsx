import { api, japi } from '../api/api';
import { navigateAway, webReturnTarget } from '../api/oauth-return';
import { Offering, Purchasable, PurchaseResult } from './offering';

const DESCRIPTION = `
• Read receipts
• 100 club slots
• Dark mode & custom themes
• Extra privacy settings
• Update your display name
• Special Gold badge on your profile
`.trim();

const purchase = async (): Promise<PurchaseResult> => {
  const response = await japi<{ approve_url: string }>(
    'post',
    '/paypal/subscribe',
    { redirect_target: webReturnTarget() },
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

const getPurchasable = async (): Promise<Purchasable | null> => {
  const response = await api<Omit<Offering, 'description'>>('get', '/paypal/plan');
  if (!response.ok || !response.json) return null;
  return {
    offering: { ...response.json, description: DESCRIPTION },
    purchase,
  };
};

export {
  getPurchasable,
};
