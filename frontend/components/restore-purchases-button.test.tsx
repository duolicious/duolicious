import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RestorePurchasesButton } from './restore-purchases-button';
import { restorePurchases } from '../purchases/purchases';
import { Toast } from './toast';
import { getSignedInUser, setSignedInUser } from '../events/signed-in-user';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

let mockRestorePurchases: () => Promise<{ activeSubscriptions: string[] }>;

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { executionEnvironment: 'standalone' },
  ExecutionEnvironment: { StoreClient: 'storeClient' },
}));

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: () => {},
    setDebugLogsEnabled: () => {},
    restorePurchases: () => mockRestorePurchases(),
  },
}));

jest.mock('./logo', () => ({ Logo14: () => null }));
jest.mock('./logo/logo-activity-indicator', () => ({
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
  ({ activeSubscriptions });

const pressRestorePurchases = async (): Promise<string> => {
  let root: ReturnType<typeof create>;
  await act(async () => {
    root = create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        {restorePurchases &&
          <RestorePurchasesButton restorePurchases={restorePurchases} />
        }
        <Toast />
      </SafeAreaProvider>
    );
  });

  expect(textOf(root.toJSON())).toContain('Restore Purchases');

  await act(async () => {
    root.root
      .findAll((node: { props: { onPress?: unknown } }) =>
        typeof node.props.onPress === 'function')[0]
      .props.onPress();
  });
  await act(async () => {
    jest.runAllTimers();
  });

  const text = textOf(root.toJSON());
  act(() => root.unmount());

  return text;
};

describe('pressing Restore Purchases in the mobile apps', () => {
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

  test('gives Gold to this account when the store bills for it', async () => {
    mockRestorePurchases = storeAccountWith(['weekly']);

    const shown = await pressRestorePurchases();

    expect(shown).toContain('Your Gold subscription is now on this account');
    expect(getSignedInUser()?.hasGold).toBe(true);
  });

  test('says there’s nothing to restore when the store has no live subscription', async () => {
    mockRestorePurchases = storeAccountWith([]);

    const shown = await pressRestorePurchases();

    expect(shown).toContain('Nothing to restore');
    expect(getSignedInUser()?.hasGold).toBe(false);
  });

  test('asks to try again later when the store can’t be reached', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockRestorePurchases = async () => { throw new Error('Network error'); };

    const shown = await pressRestorePurchases();

    expect(shown).toContain('Try again later');
    expect(getSignedInUser()?.hasGold).toBe(false);
  });
});
