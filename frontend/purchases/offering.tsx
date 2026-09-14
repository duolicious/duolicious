import * as _ from 'lodash';

type OfferingInterval = {
  units: number,
  unit: string,
};

type PurchaseResult = 'purchased' | 'cancelled' | 'failed';

type Purchasable = {
  price: string,
  amount: number,
  cycle: OfferingInterval,
  trial: OfferingInterval | null,
  purchase: () => Promise<PurchaseResult>,
};

type Offering = {
  product_name: string,
  description: string,
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

const bestValue = (purchasables: Purchasable[]): Purchasable =>
  _.minBy(purchasables, weeklyRate) ?? purchasables[0];

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
  bestValue,
  byCycleLength,
  savings,
};
