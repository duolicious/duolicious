import { expect, jest, test } from '@jest/globals';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PointOfSaleModal, showPointOfSale } from './point-of-sale-modal';
import { lastEvent } from '../../events/events';
import { getSignedInUser, setSignedInUser } from '../../events/signed-in-user';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

jest.mock('../../purchases/purchases', () => ({
  getOffering: async () => 'subscribed',
}));
jest.mock('../logo/logo-activity-indicator', () => ({
  LogoActivityIndicator: () => null,
}));

test('a restored store subscription grants Gold and closes the paywall', async () => {
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

  expect(getSignedInUser()?.hasGold).toBe(true);
  expect(lastEvent('show-point-of-sale')).toBeNull();

  act(() => root.unmount());
});
