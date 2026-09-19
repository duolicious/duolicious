import 'react-native-get-random-values';
import { Platform } from 'react-native';
import Purchases, {
  INTRO_ELIGIBILITY_STATUS,
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { getSignedInUser } from '../events/signed-in-user';
import { memoizeWithTtl } from '../util/util';
import {
  Offering,
  OfferingInterval,
  Purchasable,
  PurchaseResult,
} from './offering';

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

const PERIOD_UNITS: Record<string, string> = {
  D: 'day',
  W: 'week',
  M: 'month',
  Y: 'year',
};

const parsePeriod = (period: string | null): OfferingInterval | null => {
  const match = (period ?? '').match(/^P(\d+)([DWMY])$/);
  return match && { units: Number(match[1]), unit: PERIOD_UNITS[match[2]] };
};

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

const toPurchasable = (
  pkg: PurchasesPackage,
  trialEligible: boolean,
): Purchasable | null => {
  const cycle = parsePeriod(pkg.product.subscriptionPeriod);
  const intro = pkg.product.introPrice;
  return cycle && {
    price: pkg.product.priceString,
    pricePerMonth: pkg.product.pricePerMonthString,
    amount: pkg.product.price,
    cycle,
    trial: trialEligible && intro?.price === 0 ? parsePeriod(intro.period) : null,
    purchase: () => purchasePackage(pkg),
  };
};

const getOffering = async (): Promise<Offering | null> => {
  const personUuid = getSignedInUser()?.personUuid;
  if (!personUuid) return null;

  await ensurePurchasesConfigured();
  const offering = await getCurrentOfferingForUserMemoized(personUuid);
  if (!offering) return null;

  const eligibility = await Purchases.checkTrialOrIntroductoryPriceEligibility(
    offering.availablePackages.map((pkg) => pkg.product.identifier));
  const purchasables = offering.availablePackages.flatMap((pkg) =>
    toPurchasable(
      pkg,
      eligibility[pkg.product.identifier]?.status !==
        INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE,
    ) ?? []
  );
  if (purchasables.length === 0) return null;

  return { purchasables };
};

export {
  getOffering,
};
