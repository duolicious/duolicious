import { Linking } from 'react-native';
import { DefaultText } from './default-text';
import { useSignedInUser } from '../events/signed-in-user';
import { useProfileInfo } from '../events/profile-info';

const StoreLink = ({ name, url }: { name: string, url: string }) => (
  <DefaultText
    disableTheme
    onPress={() => Linking.openURL(url)}
    style={{ fontWeight: '700' }}
  >
    {name}
  </DefaultText>
);

const StoreSubscriptionWarning = () => {
  const [signedInUser] = useSignedInUser();
  const profileInfo = useProfileInfo();

  if (!signedInUser?.hasGold || profileInfo?.paypal_subscription) {
    return null;
  }

  return (
    <>
      Deleting your account won’t cancel your Gold subscription. If you
      haven’t already, cancel it in {}
      <StoreLink
        name="the App Store"
        url="https://apps.apple.com/account/subscriptions"
      /> or {}
      <StoreLink
        name="Google Play"
        url="https://play.google.com/store/account/subscriptions"
      />. {}
    </>
  );
};

export {
  StoreSubscriptionWarning,
};
