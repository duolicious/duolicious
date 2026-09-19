import * as _ from 'lodash';
import { pluralize } from '../util/util';

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
  trial: OfferingInterval | null,
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

const byCycleLength = (purchasables: Purchasable[]) =>
  _.sortBy(purchasables, (p) => monthsIn(p.cycle));

const intervalText = ({ units, unit }: OfferingInterval) =>
  `${units} ${pluralize(unit, units)}`;

const renewalText = ({ price, cycle }: Purchasable) =>
  cycle.units === 1
    ? `${price}/${cycle.unit}`
    : `${price} every ${intervalText(cycle)}`;

export {
  Offering,
  OfferingInterval,
  Purchasable,
  PurchaseResult,
  byCycleLength,
  intervalText,
  monthsIn,
  renewalText,
};
