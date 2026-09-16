import { Purchasable, byCycleLength, monthsIn, savings } from './offering';

const purchasable = (amount: number, units: number, unit: string): Purchasable => ({
  price: `$${amount}`,
  pricePerMonth: null,
  amount,
  cycle: { units, unit },
  purchase: async () => 'purchased',
});

const week = purchasable(4.99, 1, 'week');
const month = purchasable(5.99, 1, 'month');
const quarter = purchasable(15.99, 3, 'month');

test('longer cycles cost less per month', () => {
  const sorted = byCycleLength([quarter, week, month]);

  expect(sorted).toEqual([week, month, quarter]);
  expect(sorted.map((p) => monthsIn(p.cycle))).toEqual([12 / 52, 1, 3]);
  expect(sorted.map((p) => savings(p, sorted))).toEqual([0, 72, 75]);
});
