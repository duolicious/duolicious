import { beforeEach, expect, jest, test } from '@jest/globals';
import Purchases from 'react-native-purchases';
import { getOffering } from './purchases';

type SyncResult = { customerInfo: { activeSubscriptions: string[] } };

let mockSync: () => Promise<SyncResult>;

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'standalone' },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));

jest.mock('../events/signed-in-user', () => ({
  getSignedInUser: () => ({ personUuid: 'person-uuid' }),
}));

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  INTRO_ELIGIBILITY_STATUS: { INTRO_ELIGIBILITY_STATUS_INELIGIBLE: 1 },
  default: {
    configure: jest.fn(),
    setDebugLogsEnabled: jest.fn(),
    syncPurchasesForResult: jest.fn(() => mockSync()),
    getOfferings: jest.fn(async () => ({
      current: {
        availablePackages: [{
          product: {
            identifier: 'weekly',
            priceString: '$4.99',
            pricePerWeekString: '$4.99',
            subscriptionPeriod: 'P1W',
            introPrice: null,
          },
        }],
      },
    })),
    checkTrialOrIntroductoryPriceEligibility: jest.fn(async () => ({})),
  },
}));

const synced = (activeSubscriptions: string[]) => async () =>
  ({ customerInfo: { activeSubscriptions } });

const weeklyPlan = {
  purchasables: [{
    price: '$4.99',
    cycle: { units: 1, unit: 'week' },
    trial: null,
  }],
};

beforeEach(() => {
  jest.clearAllMocks();
});

test('a live store subscription is restored instead of offering plans', async () => {
  mockSync = synced(['weekly']);

  expect(await getOffering()).toBe('subscribed');
  expect(Purchases.getOfferings).not.toHaveBeenCalled();
});

test('plans are offered when the store has no live subscription', async () => {
  mockSync = synced([]);

  expect(await getOffering()).toMatchObject(weeklyPlan);
});

test('plans are still offered when the sync fails', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockSync = async () => { throw new Error('network'); };

  expect(await getOffering()).toMatchObject(weeklyPlan);
});
