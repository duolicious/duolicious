import { useCallback } from 'react';
import {
  CompositeNavigationProp,
  StackActions,
  useNavigation,
} from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { HomeParamList, RootParamList } from './linking';
import { setProspectHint } from './prospect-cache';

const useProfileLink = (
  personUuid: string,
  urlSlug: string | null,
  photoBlurhash: string | null,
  verificationRequired: string | null,
  onOpen?: () => void,
) => {
  const navigation = useNavigation<CompositeNavigationProp<
    BottomTabNavigationProp<HomeParamList>,
    NativeStackNavigationProp<RootParamList>
  >>();

  // The profile URL prefers the username (url_slug); the uuid is the fallback
  // for not-yet-backfilled users and shared links.
  const handle = urlSlug || personUuid;

  const onPress = useCallback(() => {
    if (verificationRequired) {
      return navigation.navigate('Profile');
    } else if (personUuid) {
      onOpen?.();
      setProspectHint(handle, { photoBlurhash });
      return navigation.dispatch(StackActions.push(
        'Prospect Profile Screen',
        {
          screen: 'Prospect Profile',
          params: { personUuid: handle },
        }
      ));
    }
  }, [navigation, personUuid, handle, photoBlurhash, verificationRequired, onOpen]);

  const link = verificationRequired
    ? undefined
    : { href: `/${handle}`, onOpenInNewTab: onOpen };

  return { onPress, link };
};

export {
  useProfileLink,
};
