import * as _ from 'lodash';
import { pluralize } from '../util/util';

type OfferingInterval = {
  units: number,
  unit: string,
};

type PurchaseResult = 'purchased' | 'cancelled' | 'failed';

type Purchasable = {
  price: string,
  pricePerWeek: string | null,
  cycle: OfferingInterval,
  trial: OfferingInterval | null,
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

const byCycleLength = (purchasables: Purchasable[]) =>
  _.sortBy(purchasables, (p) => weeksIn(p.cycle));

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
  renewalText,
  weeksIn,
};
