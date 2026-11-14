import { Platform } from 'react-native';
import { listen } from '../../events/events';
import { offerNotificationsOnce } from './notification-offer-modal';

jest.mock('./choice-modal', () => ({ ChoiceModal: () => null }));

const mockKv: Record<string, string> = {};

jest.mock('../../kv-storage/kv-storage', () => ({
  storeKv: async (key: string, value?: string) => {
    if (value === undefined) return mockKv[key] ?? null;
    mockKv[key] = value;
  },
}));

jest.mock('../../events/signed-in-user', () => ({
  getSignedInUser: () => ({ personUuid: 'me' }),
}));

let mockIsMobile = false;
let mockIsStandalone = false;
let mockCanAskForWebPush = false;

jest.mock('../../util/util', () => ({
  ...jest.requireActual('../../util/util'),
  isMobileWeb: () => mockIsMobile,
}));

Object.defineProperty(window, 'matchMedia', {
  value: () => ({ matches: mockIsStandalone }),
});

jest.mock('../../notifications/web-push', () => ({
  canAskForWebPush: () => mockCanAskForWebPush,
  requestAndRegisterWebPush: jest.fn(async () => {}),
}));

const offer = { title: 'Title', message: 'Message.' };

const countOffers = async (attempts: number) => {
  const offers: unknown[] = [];
  const unlisten = listen('notification-offer', (x) => offers.push(x));
  for (let i = 0; i < attempts; i++) {
    await offerNotificationsOnce(offer);
  }
  unlisten();
  return offers.length;
};

describe('offerNotificationsOnce', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockKv)) delete mockKv[key];
    mockIsMobile = false;
    mockIsStandalone = false;
    mockCanAskForWebPush = false;
  });

  it('never offers inside the native app', async () => {
    mockIsMobile = true;
    jest.replaceProperty(Platform, 'OS', 'ios');

    expect(await countOffers(1)).toBe(0);
  });

  it('offers mobile web the app once', async () => {
    mockIsMobile = true;
    jest.replaceProperty(Platform, 'OS', 'web');

    expect(await countOffers(3)).toBe(1);
  });

  it('offers a phone’s installed web app only while the browser can still ask', async () => {
    mockIsMobile = true;
    mockIsStandalone = true;
    jest.replaceProperty(Platform, 'OS', 'web');

    expect(await countOffers(1)).toBe(0);

    mockCanAskForWebPush = true;
    expect(await countOffers(3)).toBe(1);
  });

  it('offers desktop web only while the browser can still ask', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');

    expect(await countOffers(1)).toBe(0);

    mockCanAskForWebPush = true;
    expect(await countOffers(3)).toBe(1);
  });
});
