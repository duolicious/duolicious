import 'react-native-get-random-values';
import { Platform } from 'react-native';
import Purchases, {
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { getSignedInUser } from '../events/signed-in-user';
import { memoizeWithTtl } from '../util/util';
import { Offering, Purchasable, PurchaseResult } from './offering';

type ApiKeys = {
  apple: string;
  google: string;
  web: string;
};

const API_KEYS: ApiKeys = {
  apple: 'appl_kZWpuQifTvzoMWXaHawKZLSyEIf',
  google: 'goog_QNjAZZCsYwDXpCKuefskbAPUyje',
  web: 'rcb_MXlKZzQKIINGfBiYlObkCLZXxzrH',
};

const FIVE_MINUTES_MS = 5 * 60 * 1000;

const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const selectApiKey = (os: string, expoGo: boolean, keys: ApiKeys): string => {
  if (expoGo) return keys.web;
  if (os === 'android') return keys.google;
  if (os === 'ios') return keys.apple;
  return keys.web;
};

const toOffering = (
  offering: PurchasesOffering,
  pkg: PurchasesPackage,
): Offering => ({
  product_name: offering.serverDescription,
  price: pkg.product.priceString,
  currency: pkg.product.currencyCode,
  cycle: { units: 1, unit: pkg.packageType.toLowerCase().replace(/ly$/, '') },
  trial: pkg.product.introPrice && {
    units: pkg.product.introPrice.periodNumberOfUnits,
    unit: pkg.product.introPrice.periodUnit.toLowerCase(),
  },
  description: String(offering.metadata.description),
});

let configuredForAppUserId: string | undefined;
let configureInFlight: Promise<void> | null = null;

const configureForUser = async (personUuid: string, apiKey: string) => {
  Purchases.configure({ appUserID: personUuid, apiKey });
  configuredForAppUserId = personUuid;
};

const logInForUser = async (personUuid: string) => {
  await Purchases.logIn(personUuid);
  configuredForAppUserId = personUuid;
};

const startConfigure = (task: () => Promise<void>): Promise<void> => {
  if (configureInFlight) {
    return configureInFlight;
  }

  configureInFlight = (async () => {
    try {
      await task();
    } finally {
      configureInFlight = null;
    }
  })();

  return configureInFlight;
};

const ensurePurchasesConfigured = async (): Promise<void> => {
  const personUuid = getSignedInUser()?.personUuid;

  if (!personUuid) {
    return;
  }

  if (configuredForAppUserId === personUuid) {
    return;
  }

  const isSwitchingUser = Boolean(
    configuredForAppUserId &&
    configuredForAppUserId !== personUuid
  );

  if (isSwitchingUser) {
    await startConfigure(() => logInForUser(personUuid));
    return;
  }

  Purchases.setDebugLogsEnabled(isExpoGo);
  const apiKey = selectApiKey(Platform.OS, isExpoGo, API_KEYS);
  await startConfigure(() => configureForUser(personUuid, apiKey));
};

const fetchCurrentOfferingForUser = async (
  _: string
): Promise<PurchasesOffering | null> => {
  const offerings = await Purchases.getOfferings();
  return offerings?.current ?? null;
};

const getCurrentOfferingForUserMemoized = memoizeWithTtl<
  PurchasesOffering | null, [string]
>(
  fetchCurrentOfferingForUser,
  FIVE_MINUTES_MS,
  (personUuid) => personUuid
);

const purchasePackage = async (
  pkg: PurchasesPackage,
): Promise<PurchaseResult> => {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return customerInfo.allPurchasedProductIdentifiers.includes(
      pkg.product.identifier) ? 'purchased' : 'failed';
  } catch (e) {
    if (e?.userCancelled) return 'cancelled';
    console.error(e);
    return 'failed';
  }
};

const getPurchasable = async (): Promise<Purchasable | null> => {
  const personUuid = getSignedInUser()?.personUuid;
  if (!personUuid) return null;

  await ensurePurchasesConfigured();
  const offering = await getCurrentOfferingForUserMemoized(personUuid);
  const pkg = offering?.availablePackages.at(0);
  if (!offering || !pkg) return null;

  return {
    offering: toOffering(offering, pkg),
    purchase: () => purchasePackage(pkg),
  };
};

export {
  getPurchasable,
};
