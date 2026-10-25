import { describe, expect, test } from '@jest/globals';
import { Text } from 'react-native';
import { StoreSubscriptionWarning } from './store-subscription-warning';
import { SignedInUser, setSignedInUser } from '../events/signed-in-user';
import { ProfileInfo, setProfileInfo } from '../events/profile-info';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

type RenderedNode = string | { children: RenderedNode[] | null } | null;

const textOf = (node: RenderedNode): string =>
  typeof node === 'string'
    ? node
    : (node?.children ?? []).map(textOf).join('');

const user = (hasGold: boolean): SignedInUser => ({
  personId: 1,
  personUuid: 'person-uuid',
  units: 'Metric',
  sessionToken: 'token',
  pendingClub: null,
  estimatedEndDate: new Date(),
  name: null,
  hasGold,
});

const renderedText = (
  hasGold: boolean,
  paypalSubscription: ProfileInfo['paypal_subscription'],
): string => {
  setSignedInUser(user(hasGold));
  setProfileInfo({ paypal_subscription: paypalSubscription });

  let root: ReturnType<typeof create>;
  act(() => {
    root = create(<Text><StoreSubscriptionWarning /></Text>);
  });

  const text = textOf(root.toJSON());
  act(() => root.unmount());

  return text;
};

describe('the account deletion warning about store subscriptions', () => {
  test('shows for Gold bought through a store', () => {
    expect(renderedText(true, null)).toBe(
      'Deleting your account won’t cancel your Gold subscription. If you ' +
      'haven’t already, cancel it in the App Store or Google Play. ');
  });

  test('is hidden without Gold', () => {
    expect(renderedText(false, null)).toBe('');
  });

  test('is hidden for PayPal subscriptions, which deletion cancels', () => {
    expect(renderedText(true, { can_cancel: true, paid_until: '' })).toBe('');
  });
});
