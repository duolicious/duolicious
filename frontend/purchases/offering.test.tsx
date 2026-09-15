import { Purchasable, byCycleLength, savings, weeksIn } from './offering';

const purchasable = (amount: number, units: number, unit: string): Purchasable => ({
  price: `$${amount}`,
  pricePerWeek: null,
  amount,
  cycle: { units, unit },
  purchase: async () => 'purchased',
});

const week = purchasable(1.99, 1, 'week');
const month = purchasable(3.99, 1, 'month');
const quarter = purchasable(9.99, 3, 'month');

test('longer cycles cost less per week', () => {
  const sorted = byCycleLength([quarter, week, month]);

  expect(sorted).toEqual([week, month, quarter]);
  expect(sorted.map((p) => weeksIn(p.cycle))).toEqual([1, 13 / 3, 13]);
  expect(sorted.map((p) => savings(p, sorted))).toEqual([0, 54, 61]);
});
