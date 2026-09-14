import { Purchasable, bestValue, byCycleLength, savings } from './offering';

const purchasable = (amount: number, unit: string): Purchasable => ({
  price: `$${amount}`,
  amount,
  cycle: { units: 1, unit },
  trial: null,
  purchase: async () => 'purchased',
});

const week = purchasable(1.99, 'week');
const month = purchasable(3.99, 'month');
const year = purchasable(30, 'year');

test('longer cycles cost less per week', () => {
  const sorted = byCycleLength([year, week, month]);

  expect(sorted).toEqual([week, month, year]);
  expect(bestValue(sorted)).toBe(year);
  expect(sorted.map((p) => savings(p, sorted))).toEqual([0, 54, 71]);
});
