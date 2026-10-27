import * as StoreReview from 'expo-store-review';
import { AppState, NativeEventSubscription } from 'react-native';
import type { ChatMessage } from '../chat/application-layer';
import { delay } from '../util/util';

const maybeRequestReview = async (delayMs: number = 0) => {
  if (await StoreReview.isAvailableAsync()) {
    await delay(delayMs);
    await StoreReview.requestReview();
  }
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
