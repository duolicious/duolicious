import {
  useCallback,
} from 'react';
import {
  GestureResponderEvent,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { DefaultText } from './default-text';
import {
  IMAGES_URL,
} from '../env/env';
import { isOpenInNewTabPress, makeLinkProps } from '../util/navigation'
import Ionicons from '@expo/vector-icons/Ionicons';
import { X } from "react-native-feather";
import { ImageBackground } from "expo-image";
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome'
import { faLock } from '@fortawesome/free-solid-svg-icons/faLock'
import { OnlineIndicator } from './online-indicator';
import { useAppTheme } from '../app-theme/app-theme';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { HomeParamList, RootParamList } from '../navigation/linking';
import { setProspectHint } from '../navigation/prospect-cache';

const Avatar = ({
  percentage,
  personUuid,
  urlSlug = null,
  photoUuid,
  photoBlurhash,
  isSkipped = false,
  verificationRequired = null,
  doUseOnline = true,
  disableProfileNavigation = false,
}: {
  percentage: number
  personUuid: string
  urlSlug?: string | null
  photoUuid: string | null
  photoBlurhash: string | null
  isSkipped?: boolean
  verificationRequired?: 'basics' | 'photos' | null
  doUseOnline?: boolean
  disableProfileNavigation?: boolean
}) => {
  const { appTheme } = useAppTheme();

  const navigation = useNavigation<CompositeNavigationProp<
    BottomTabNavigationProp<HomeParamList>,
    NativeStackNavigationProp<RootParamList>
  >>();

  // The profile URL prefers the username (url_slug); the uuid is the fallback
  // for not-yet-backfilled users and shared links.
  const handle = urlSlug || personUuid;

  const onPress = useCallback((e: GestureResponderEvent) => {
    if (isOpenInNewTabPress(e)) {
      return;
    }

    e.preventDefault();

    if (!navigation) {
      return;
    }

    if (verificationRequired) {
      return navigation.navigate('Profile');
    } else if (personUuid) {
      setProspectHint(handle, { photoBlurhash });
      return navigation.navigate(
        'Prospect Profile Screen',
        {
          screen: 'Prospect Profile',
          params: { personUuid: handle },
        }
      );
    }
  }, [navigation, personUuid, handle, photoBlurhash, verificationRequired]);

  const isLinkToProfile = navigation && !verificationRequired && personUuid && !disableProfileNavigation;

  const link =
    isLinkToProfile
      ? makeLinkProps(`/${handle}`)
      : {};

  return (
    <Pressable
      onPress={onPress}
      style={styles.elementStyle}
      disabled={!isLinkToProfile}
      {...link}
    >
      {!Boolean(photoUuid || photoBlurhash) &&
        <View
          style={[
            styles.imageStyle,
            {
              backgroundColor: appTheme.avatarBackgroundColor,
            },
          ]}
        >
          <Ionicons
            style={{
              fontSize: 40,
              color: appTheme.avatarColor,
            }}
            name={'person'}
          />
        </View>
      }
      {Boolean(photoUuid || photoBlurhash) &&
        <ImageBackground
          source={photoUuid ? {
            uri: `${IMAGES_URL}/450-${photoUuid}.jpg`,
            height: 450,
            width: 450,
          } : undefined}
          placeholder={photoBlurhash && { blurhash: photoBlurhash }}
          transition={!photoUuid ? { duration: 0, effect: null } : 150}
          style={styles.imageStyle}
          contentFit="contain"
          placeholderContentFit="contain"
          recyclingKey={photoUuid}
        >
          {verificationRequired &&
            <View
              style={{
                ...StyleSheet.absoluteFillObject,
                zIndex: 999,
                backgroundColor: `${appTheme.primaryColor}B3`,
              }}
            />
          }
        </ImageBackground>
      }
      {doUseOnline &&
        <OnlineIndicator
          personUuid={personUuid}
          size={20}
          borderWidth={2}
          style={{
            position: 'absolute',
            bottom: 6,
            right: 6,
          }}
        />
      }
      {percentage !== undefined &&
        <View
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            height: 30,
            width: 30,
            borderRadius: 999,
            borderColor: appTheme.primaryColor,
            borderWidth: 2,
            backgroundColor: '#70f',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <DefaultText
            style={{
              color: 'white',
              textAlign: 'center',
              fontWeight: '700',
              fontSize: 10,
            }}
          >
            {percentage}%
          </DefaultText>
          {verificationRequired &&
            <View
              style={{
                ...StyleSheet.absoluteFillObject,
                zIndex: 999,
                backgroundColor: `${appTheme.primaryColor}B3`,
              }}
            >
            </View>
          }
        </View>
      }
      {isSkipped &&
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: appTheme.primaryColor,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <X
            stroke="#70f"
            strokeWidth={3}
            height={48}
            width={48}
          />
        </View>
      }
      {verificationRequired &&
        <View
          style={{
            ...StyleSheet.absoluteFillObject,
            justifyContent: 'center',
            alignItems: 'center',
            gap: 5,
            borderRadius: 999,
          }}
        >
          <FontAwesomeIcon
            icon={faLock}
            size={18}
            style={{color: appTheme.secondaryColor }}
          />
          <DefaultText
            style={{
              fontSize: 12,
              fontWeight: '900',
              textAlign: 'center',
            }}
          >
            Verify your {verificationRequired} to unlock
          </DefaultText>
        </View>
      }
    </Pressable>
  )
};

const styles = StyleSheet.create({
  elementStyle: {
    height: 90,
    width: 90,
  },
  imageStyle: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 999,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    margin: 4,
  },
});

export {
  Avatar,
};
