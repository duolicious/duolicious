import * as _ from 'lodash';

type OfferingInterval = {
  units: number,
  unit: string,
};

type PurchaseResult = 'purchased' | 'cancelled' | 'failed';

type Purchasable = {
  price: string,
  pricePerWeek: string | null,
  amount: number,
  cycle: OfferingInterval,
  purchase: () => Promise<PurchaseResult>,
};

type Offering = {
  purchasables: Purchasable[],
};

const WEEKS_PER_UNIT: Record<string, number> = {
  day: 1 / 7,
  week: 1,
  month: 52 / 12,
  year: 52,
};

const weeksIn = (cycle: OfferingInterval) =>
  cycle.units * (WEEKS_PER_UNIT[cycle.unit] ?? 1);

const weeklyRate = (purchasable: Purchasable) =>
  purchasable.amount / weeksIn(purchasable.cycle);

const byCycleLength = (purchasables: Purchasable[]) =>
  _.sortBy(purchasables, (p) => weeksIn(p.cycle));

const savings = (purchasable: Purchasable, purchasables: Purchasable[]) =>
  Math.round(
    (1 - weeklyRate(purchasable) / Math.max(...purchasables.map(weeklyRate)))
    * 100
  );

export {
  Offering,
  OfferingInterval,
  Purchasable,
  PurchaseResult,
  byCycleLength,
  savings,
  weeksIn,
};
