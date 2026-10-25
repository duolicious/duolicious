import { describe, expect, jest, test } from '@jest/globals';
import { createElement } from 'react';
import { deletionOptionGroups } from './option-groups';
import { SignedInUser, setSignedInUser } from '../events/signed-in-user';
import { ProfileInfo, setProfileInfo } from '../events/profile-info';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

jest.mock('../App', () => ({ navigationContainerRef: {} }));
jest.mock('../chat/websocket-layer', () => ({}));
jest.mock('../components/logo', () => ({}));
jest.mock('../navigation/reset-client-state', () => ({}));
jest.mock('../notifications/notifications', () => ({}));
jest.mock('../purchases/purchases', () => ({}));

type RenderedNode = string | { children: RenderedNode[] | null } | null;

const textOf = (node: RenderedNode): string =>
  typeof node === 'string'
    ? node
    : (node?.children ?? []).map(textOf).join('');

const signedInUser = (hasGold: boolean): SignedInUser => ({
  personId: 1,
  personUuid: 'person-uuid',
  units: 'Metric',
  sessionToken: 'token',
  pendingClub: null,
  estimatedEndDate: new Date(),
  name: null,
  hasGold,
});

const deletionScreenText = (
  hasGold: boolean,
  paypalSubscription: ProfileInfo['paypal_subscription'],
): string => {
  setSignedInUser(signedInUser(hasGold));
  setProfileInfo({ paypal_subscription: paypalSubscription });

  const { description } = deletionOptionGroups[0];
  let root: ReturnType<typeof create>;
  act(() => {
    root = create(
      typeof description === 'string' ? description : createElement(description));
  });

  const text = textOf(root.toJSON());
  act(() => root.unmount());

  return text;
};

const STORE_WARNING =
  'Deleting your account won’t cancel your Gold subscription. If you ' +
  'haven’t already, cancel it in the App Store or Google Play.';

describe('the account deletion screen', () => {
  test('tells people with App Store or Google Play Gold to cancel it there', () => {
    expect(deletionScreenText(true, null)).toBe(
      'Are you sure you want to delete your account? This will permanently ' +
      'delete your account data and immediately log you out. ' +
      `${STORE_WARNING} If you’re sure, type “delete” to confirm.`);
  });

  test('says nothing about cancelling to people without Gold', () => {
    expect(deletionScreenText(false, null)).not.toContain(STORE_WARNING);
  });

  test('says nothing about cancelling to PayPal subscribers, whose subscription deletion cancels', () => {
    expect(deletionScreenText(true, { can_cancel: true, paid_until: '' }))
      .not.toContain(STORE_WARNING);
  });
});
