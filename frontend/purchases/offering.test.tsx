import {
  Purchasable,
  byCycleLength,
  intervalText,
  renewalText,
  weeksIn,
} from './offering';

const purchasable = (amount: number, units: number, unit: string): Purchasable => ({
  price: `$${amount}`,
  pricePerWeek: null,
  cycle: { units, unit },
  trial: null,
  purchase: async () => 'purchased',
});

const week = purchasable(4.99, 1, 'week');
const month = purchasable(5.99, 1, 'month');
const quarter = purchasable(15.99, 3, 'month');

test('longer cycles cost less per month', () => {
  const sorted = byCycleLength([quarter, week, month]);

  expect(sorted).toEqual([week, month, quarter]);
  expect(sorted.map((p) => weeksIn(p.cycle))).toEqual([1, 52 / 12, 13]);
});

test('trial and renewal copy', () => {
  expect(intervalText({ units: 7, unit: 'day' })).toBe('7 days');
  expect(intervalText({ units: 1, unit: 'week' })).toBe('1 week');
  expect(renewalText(week)).toBe('$4.99/week');
  expect(renewalText(month)).toBe('$5.99/month');
  expect(renewalText(quarter)).toBe('$15.99 every 3 months');
});
