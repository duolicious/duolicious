type OfferingInterval = {
  units: number,
  unit: string,
};

type Offering = {
  product_name: string,
  price: string,
  currency: string,
  cycle: OfferingInterval,
  trial: OfferingInterval | null,
  description: string,
};

type PurchaseResult = 'purchased' | 'cancelled' | 'failed';

type Purchasable = {
  offering: Offering,
  purchase: () => Promise<PurchaseResult>,
};

export {
  Offering,
  Purchasable,
  PurchaseResult,
};
