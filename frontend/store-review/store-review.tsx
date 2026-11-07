import * as StoreReview from 'expo-store-review';
import { AppState, NativeEventSubscription } from 'react-native';
import type { ChatMessage } from '../chat/application-layer';
import { storeKv } from '../kv-storage/kv-storage';
import { delay } from '../util/util';

const MIN_MS_BETWEEN_REQUESTS = 120 * 24 * 60 * 60 * 1000;

const maybeRequestReview = async (delayMs: number = 0) => {
  const lastRequestTime = Number(await storeKv('last_review_request_time'));

  if (Date.now() - lastRequestTime < MIN_MS_BETWEEN_REQUESTS) return;
  if (!await StoreReview.isAvailableAsync()) return;

  await storeKv('last_review_request_time', String(Date.now()));
  await delay(delayMs);
  await StoreReview.requestReview();
};

let returnSubscription: NativeEventSubscription | undefined;

const maybeRequestReviewOnReturn = () => {
  returnSubscription?.remove();
  returnSubscription = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    returnSubscription?.remove();
    maybeRequestReview(1000);
  });
};

const isMutualConversation = (messages: ChatMessage[]): boolean => {
  const sides = [
    messages.filter((m) => m.fromCurrentUser),
    messages.filter((m) => !m.fromCurrentUser),
  ];

  return sides.every((side) =>
    side.length >= 5 &&
    new Set(side.map((m) => m.timestamp.toDateString())).size >= 2
  );
};

export {
  isMutualConversation,
  maybeRequestReview,
  maybeRequestReviewOnReturn,
};
