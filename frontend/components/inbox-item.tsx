import {
  Animated,
  Pressable,
  View,
} from 'react-native';
import {
  useCallback,
} from 'react';
import { DefaultText } from './default-text';
import { Avatar } from './avatar';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootParamList } from '../navigation/linking';
import { friendlyTimestamp, isMobile } from '../util/util';
import { VerificationBadge } from './verification-badge';
import { usePressableAnimation } from '../animation/animation';
import { setProspectHint } from '../navigation/prospect-cache';
import { navigateToConversation } from '../navigation/use-navigation-to-conversation';

const IntrosItem = ({
  wasRead,
  name,
  personUuid,
  urlSlug,
  photoUuid,
  photoBlurhash,
  matchPercentage,
  lastMessageTimestamp,
  isAvailableUser,
  isVerified,
  isOpen = false,
}: {
  wasRead: boolean
  name: string
  personUuid: string
  urlSlug: string | null
  photoUuid: string | null
  photoBlurhash: string | null
  matchPercentage: number
  lastMessage: string
  lastMessageTimestamp: Date
  isAvailableUser: boolean
  isVerified: boolean
  isOpen?: boolean
}) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootParamList>>();

  const { backgroundColor, onPressIn, onPressOut } = usePressableAnimation(isOpen);

  // Profile links prefer the username (url_slug), falling back to the uuid.
  const handle = urlSlug || personUuid;

  const onPress = useCallback(() => {
    if (!isMobile()) {
      navigateToConversation(
        navigation,
        { personUuid, urlSlug, name, photoUuid, photoBlurhash, isAvailableUser },
      );
      return;
    }
    setProspectHint(handle, { name, photoUuid, photoBlurhash });
    navigation.navigate(
      'Prospect Profile Screen',
      {
        screen: 'Prospect Profile',
        params: { personUuid: handle },
      }
    );
  }, [handle, personUuid, urlSlug, name, photoUuid, photoBlurhash, isAvailableUser]);

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress}
    >
      <Animated.View
        style={{
          backgroundColor: backgroundColor,
          borderRadius: 15,
          flexDirection: 'row',
          alignItems: 'center',
          paddingTop: 5,
          paddingBottom: 5,
          paddingLeft: 10,
          marginLeft: 5,
          marginRight: 5,
        }}
      >
        <Avatar
          percentage={matchPercentage}
          photoUuid={photoUuid}
          photoBlurhash={photoBlurhash}
          personUuid={personUuid}
          disableProfileNavigation={true}
        />
        <View
          style={{
            paddingLeft: 10,
            paddingRight: 20,
            flexDirection: 'column',
            flex: 1,
            flexGrow: 1,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: 5,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                flexShrink: 1,
                gap: 5,
                alignItems: 'center',
                paddingBottom: 5,
              }}
            >
              <DefaultText
                style={{
                  fontSize: 16,
                  fontWeight: '700',
                  overflow: 'hidden',
                  flexWrap: 'wrap',
                  flexShrink: 1,
                }}
              >
                {name}
              </DefaultText>
              {isVerified &&
                <VerificationBadge size={18} />
              }
            </View>
            <DefaultText
              style={{
                color: 'grey',
              }}
            >
              {friendlyTimestamp(lastMessageTimestamp)}
            </DefaultText>
          </View>
          <DefaultText
            numberOfLines={1}
            style={wasRead ? {
              fontWeight: '400',
              color: 'grey',
            } : {
              fontWeight: '600',
            }}
          >
            Wants to chat
          </DefaultText>
        </View>
      </Animated.View>
    </Pressable>
  );
};

const ChatsItem = ({
  wasRead,
  name,
  personUuid,
  urlSlug,
  photoUuid,
  photoBlurhash,
  matchPercentage,
  lastMessage,
  lastMessageTimestamp,
  isAvailableUser,
  isVerified,
  isOpen = false,
}: {
  wasRead: boolean
  name: string
  personUuid: string
  urlSlug: string | null
  photoUuid: string | null
  photoBlurhash: string | null
  matchPercentage: number
  lastMessage: string
  lastMessageTimestamp: Date
  isAvailableUser: boolean
  isVerified: boolean
  isOpen?: boolean
}) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootParamList>>();

  const { backgroundColor, onPressIn, onPressOut } = usePressableAnimation(isOpen);

  const onPress = useCallback(() => {
    navigateToConversation(
      navigation,
      { personUuid, urlSlug, name, photoUuid, photoBlurhash, isAvailableUser },
    );
  }, [personUuid, urlSlug, name, photoUuid, photoBlurhash, isAvailableUser]);

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={onPress}
    >
      <Animated.View
        style={{
          backgroundColor: backgroundColor,
          borderRadius: 15,
          flexDirection: 'row',
          alignItems: 'center',
          paddingTop: 5,
          paddingBottom: 5,
          paddingLeft: 10,
          marginLeft: 5,
          marginRight: 5,
        }}
      >
        <Avatar
          percentage={matchPercentage}
          photoUuid={photoUuid}
          photoBlurhash={photoBlurhash}
          personUuid={personUuid}
          disableProfileNavigation={true}
        />
        <View
          style={{
            paddingLeft: 10,
            paddingRight: 20,
            flexDirection: 'column',
            flex: 1,
            flexGrow: 1,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: 5,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                flexShrink: 1,
                gap: 5,
                alignItems: 'center',
                paddingBottom: 5,
              }}
            >
              <DefaultText
                style={{
                  fontSize: 16,
                  fontWeight: '700',
                  overflow: 'hidden',
                  flexWrap: 'wrap',
                  flexShrink: 1,
                }}
              >
                {name}
              </DefaultText>
              {isVerified &&
                <VerificationBadge size={18} />
              }
            </View>
            <DefaultText
              style={{
                color: 'grey',
              }}
            >
              {friendlyTimestamp(lastMessageTimestamp)}
            </DefaultText>
          </View>
          <DefaultText
            numberOfLines={1}
            style={wasRead ? {
              fontWeight: '400',
              color: 'grey',
            } : {
              fontWeight: '600',
            }}
          >
            {lastMessage}
          </DefaultText>
        </View>
      </Animated.View>
    </Pressable>
  );
};

export {
  ChatsItem,
  IntrosItem,
}
