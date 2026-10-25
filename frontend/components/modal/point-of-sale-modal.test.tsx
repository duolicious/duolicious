import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PointOfSaleModal, showPointOfSale } from './point-of-sale-modal';
import { getSignedInUser, setSignedInUser } from '../../events/signed-in-user';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

type CustomerInfo = { activeSubscriptions: string[] };

let mockSyncPurchases: () => Promise<{ customerInfo: CustomerInfo }>;

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'standalone' },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  INTRO_ELIGIBILITY_STATUS: { INTRO_ELIGIBILITY_STATUS_INELIGIBLE: 1 },
  default: {
    configure: () => {},
    setDebugLogsEnabled: () => {},
    syncPurchasesForResult: () => mockSyncPurchases(),
    getOfferings: async () => ({
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
    }),
    checkTrialOrIntroductoryPriceEligibility: async () => ({}),
  },
}));

jest.mock('../logo/logo-activity-indicator', () => ({
  LogoActivityIndicator: () => null,
}));

type RenderedNode = string | { children: RenderedNode[] | null } | null;

const textOf = (node: RenderedNode | RenderedNode[]): string =>
  Array.isArray(node)
    ? node.map(textOf).join(' ')
    : typeof node === 'string'
      ? node
      : (node?.children ?? []).map(textOf).join(' ');

const storeAccountWith = (activeSubscriptions: string[]) => async () =>
  ({ customerInfo: { activeSubscriptions } });

const openPaywall = async (): Promise<string> => {
  let root: ReturnType<typeof create>;
  await act(async () => {
    root = create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <PointOfSaleModal />
      </SafeAreaProvider>
    );
  });
  await act(async () => {
    showPointOfSale('read-receipts');
  });
  await act(async () => {
    jest.runAllTimers();
  });

  const text = textOf(root.toJSON());
  act(() => root.unmount());

  return text;
};

describe('opening the Gold paywall in the mobile apps', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setSignedInUser({
      personId: 1,
      personUuid: 'person-uuid',
      units: 'Metric',
      sessionToken: 'token',
      pendingClub: null,
      estimatedEndDate: new Date(),
      name: null,
      hasGold: false,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('gives Gold back, instead of selling it again, when the store already bills for it', async () => {
    mockSyncPurchases = storeAccountWith(['weekly']);

    const shown = await openPaywall();

    expect(shown).not.toContain('Get Gold');
    expect(getSignedInUser()?.hasGold).toBe(true);
  });

  test('offers plans when the store has no live subscription', async () => {
    mockSyncPurchases = storeAccountWith([]);

    const shown = await openPaywall();

    expect(shown).toContain('Get Gold');
    expect(shown).toContain('$4.99');
    expect(getSignedInUser()?.hasGold).toBe(false);
  });

  test('still offers plans when RevenueCat can’t be reached', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSyncPurchases = async () => { throw new Error('Network error'); };

    const shown = await openPaywall();

    expect(shown).toContain('$4.99');
    expect(getSignedInUser()?.hasGold).toBe(false);
  });
});
