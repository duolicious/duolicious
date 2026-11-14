import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { ChoiceModal } from './choice-modal';
import { listen, notify } from '../../events/events';
import { isMobileWeb } from '../../util/util';
import { APP_STORE_URL, PLAY_STORE_URL } from '../../constants/constants';
import {
  canAskForWebPush,
  requestAndRegisterWebPush,
} from '../../notifications/web-push';
import { seenNotificationOffer } from '../../kv-storage/seen-hints/seen-notification-offer';

type NotificationOffer = {
  title: string
  message: string
};

const OFFER_EVENT = 'notification-offer';
const ANSWERED_EVENT = 'notification-offer-answered';

const offersApp = (): boolean =>
  Platform.OS === 'web' &&
  isMobileWeb() &&
  !window.matchMedia('(display-mode: standalone)').matches;

const canOfferNotifications = (): boolean =>
  Platform.OS === 'web' && (offersApp() || canAskForWebPush());

const showNotificationOffer = (offer: NotificationOffer) => {
  if (canOfferNotifications()) {
    notify<NotificationOffer>(OFFER_EVENT, offer);
  }
};

const offerNotificationsOnce = async (offer: NotificationOffer) => {
  if (!canOfferNotifications() || await seenNotificationOffer()) {
    return;
  }

  await seenNotificationOffer(true);

  notify<NotificationOffer>(OFFER_EVENT, offer);
};

const useCanOfferNotifications = (): boolean => {
  const [canOffer, setCanOffer] = useState(canOfferNotifications);

  useEffect(() => listen(
    ANSWERED_EVENT,
    () => setCanOffer(canOfferNotifications()),
  ), []);

  return canOffer;
};

const openAppStore = () => Linking.openURL(
  /iphone|ipad|ipod/i.test(window.navigator.userAgent)
    ? APP_STORE_URL
    : PLAY_STORE_URL
);

const NotificationOfferModal = () => {
  const [offer, setOffer] = useState<NotificationOffer | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => listen<NotificationOffer>(OFFER_EVENT, (x) => {
    if (!x) {
      return;
    }

    setOffer(x);
    setVisible(true);
  }), []);

  const close = useCallback(() => setVisible(false), []);

  const accept = useCallback(async () => {
    setVisible(false);

    await (offersApp() ? openAppStore() : requestAndRegisterWebPush());

    notify(ANSWERED_EVENT);
  }, []);

  const phone = offersApp();

  return (
    <ChoiceModal
      visible={visible}
      title={offer?.title ?? ''}
      message={
        `${offer?.message ?? ''} ` +
        (phone
          ? 'Get the Duolicious app to be notified on your phone.'
          : 'Turn on notifications to hear about it, even when Duolicious isn’t open.')
      }
      primaryLabel={phone ? 'Get the app' : 'Turn on notifications'}
      onPressPrimary={accept}
      secondaryLabel="Not now"
      onPressSecondary={close}
    />
  );
};

export {
  NotificationOfferModal,
  offerNotificationsOnce,
  showNotificationOffer,
  useCanOfferNotifications,
};
