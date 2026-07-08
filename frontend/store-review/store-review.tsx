import * as StoreReview from 'expo-store-review';
import { askedForReviewBefore } from '../kv-storage/asked-for-review-before';
import { delay } from '../util/util';

const maybeRequestReview = async (delayMs: number = 0) => {
  if (await StoreReview.hasAction() && !await askedForReviewBefore()) {
    await delay(delayMs);
    await StoreReview.requestReview();
  }
};

export {
  maybeRequestReview,
};
