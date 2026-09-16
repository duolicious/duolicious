import * as _ from 'lodash';

type OfferingInterval = {
  units: number,
  unit: string,
};

type PurchaseResult = 'purchased' | 'cancelled' | 'failed';

type Purchasable = {
  price: string,
  pricePerMonth: string | null,
  amount: number,
  cycle: OfferingInterval,
  purchase: () => Promise<PurchaseResult>,
};

type Offering = {
  purchasables: Purchasable[],
};

const MONTHS_PER_UNIT: Record<string, number> = {
  day: 12 / 365,
  week: 12 / 52,
  month: 1,
  year: 12,
};

const monthsIn = (cycle: OfferingInterval) =>
  cycle.units * (MONTHS_PER_UNIT[cycle.unit] ?? 1);

const monthlyRate = (purchasable: Purchasable) =>
  purchasable.amount / monthsIn(purchasable.cycle);

const byCycleLength = (purchasables: Purchasable[]) =>
  _.sortBy(purchasables, (p) => monthsIn(p.cycle));

const savings = (purchasable: Purchasable, purchasables: Purchasable[]) =>
  Math.round(
    (1 - monthlyRate(purchasable) / Math.max(...purchasables.map(monthlyRate)))
    * 100
  );

export {
  Offering,
  OfferingInterval,
  Purchasable,
  PurchaseResult,
  byCycleLength,
  monthsIn,
  savings,
};
