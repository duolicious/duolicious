import {
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
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
import { setInboxSettings } from '../chat/application-layer/hooks/conversations';
import { useAppTheme } from '../app-theme/app-theme';
import Animated from 'react-native-reanimated';

const IntrosItem = ({
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

  const {
    backgroundStyle,
    onPressIn,
    onPressOut,
    hoverProps,
  } = usePressableAnimation(isOpen);

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
      {...hoverProps}
    >
      <Animated.View style={[styles.row, backgroundStyle]}>
        <Avatar
          percentage={matchPercentage}
          photoUuid={photoUuid}
          photoBlurhash={photoBlurhash}
          personUuid={personUuid}
          disableProfileNavigation={true}
        />
        <View style={styles.textColumn}>
          <View style={styles.titleRow}>
            <View style={styles.nameRow}>
              <DefaultText style={styles.name}>
                {name}
              </DefaultText>
              {isVerified &&
                <VerificationBadge size={18} />
              }
            </View>
            <DefaultText style={styles.grey}>
              {friendlyTimestamp(lastMessageTimestamp)}
            </DefaultText>
          </View>
          <DefaultText
            numberOfLines={1}
            style={wasRead ? styles.grey : styles.unread}
          >
            {lastMessage}
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

  const {
    backgroundStyle,
    onPressIn,
    onPressOut,
    hoverProps,
  } = usePressableAnimation(isOpen);

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
      {...hoverProps}
    >
      <Animated.View style={[styles.row, backgroundStyle]}>
        <Avatar
          percentage={matchPercentage}
          photoUuid={photoUuid}
          photoBlurhash={photoBlurhash}
          personUuid={personUuid}
          disableProfileNavigation={true}
        />
        <View style={styles.textColumn}>
          <View style={styles.titleRow}>
            <View style={styles.nameRow}>
              <DefaultText style={styles.name}>
                {name}
              </DefaultText>
              {isVerified &&
                <VerificationBadge size={18} />
              }
            </View>
            <DefaultText style={styles.grey}>
              {friendlyTimestamp(lastMessageTimestamp)}
            </DefaultText>
          </View>
          <DefaultText
            numberOfLines={1}
            style={wasRead ? styles.grey : styles.unread}
          >
            {lastMessage}
          </DefaultText>
        </View>
      </Animated.View>
    </Pressable>
  );
};

const showHiddenIntros = () => setInboxSettings({ showHidden: true });

const HiddenIntrosItem = ({ count }: { count: number | null }) => {
  const { appTheme } = useAppTheme();

  const {
    backgroundStyle,
    onPressIn,
    onPressOut,
    hoverProps,
  } = usePressableAnimation(false);

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={showHiddenIntros}
      {...hoverProps}
    >
      <Animated.View style={[styles.row, backgroundStyle]}>
        <View style={styles.hiddenIconBox}>
          <View
            style={[
              styles.hiddenIconCircle,
              { backgroundColor: appTheme.inputColor },
            ]}
          >
            <Ionicons
              style={{ fontSize: 36, color: appTheme.hintColor }}
              name="eye-off-outline"
            />
          </View>
        </View>
        <View style={styles.textColumn}>
          <View style={styles.titleRow}>
            <View style={styles.nameRow}>
              <DefaultText style={styles.name}>
                Hidden intros
              </DefaultText>
            </View>
            <View style={styles.countRow}>
              {count !== null &&
                <DefaultText style={styles.grey}>
                  {count}
                </DefaultText>
              }
              <Ionicons style={styles.chevron} name="chevron-forward" />
            </View>
          </View>
          <DefaultText numberOfLines={1} style={styles.grey}>
            Might be rude
          </DefaultText>
        </View>
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 5,
    paddingBottom: 5,
    paddingLeft: 10,
    marginLeft: 5,
    marginRight: 5,
  },
  textColumn: {
    paddingLeft: 10,
    paddingRight: 20,
    flexDirection: 'column',
    flex: 1,
    flexGrow: 1,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 5,
  },
  nameRow: {
    flexDirection: 'row',
    flexShrink: 1,
    gap: 5,
    alignItems: 'center',
    paddingBottom: 5,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    overflow: 'hidden',
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  grey: {
    fontWeight: '400',
    color: 'grey',
  },
  unread: {
    fontWeight: '600',
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chevron: {
    fontSize: 20,
    color: 'grey',
  },
  hiddenIconBox: {
    width: 90,
    height: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenIconCircle: {
    width: 82,
    height: 82,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export {
  ChatsItem,
  HiddenIntrosItem,
  IntrosItem,
}
