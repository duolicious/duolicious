import {
  GestureResponderEvent,
  ImageBackground as RNImageBackground,
  ImageResizeMode,
  ImageSourcePropType,
  Platform,
  Pressable,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { DefaultText } from './default-text';
import { noSelect } from '../styles';
import { photoUri } from '../util/photos';
import {
  CompositeNavigationProp,
  NavigationProp,
  useNavigation,
} from '@react-navigation/native';
import type { HomeParamList, RootParamList } from '../navigation/linking';
import Ionicons from '@expo/vector-icons/Ionicons';
import { listen } from '../events/events';
import { isOpenInNewTabPress, makeLinkProps } from '../util/navigation'
import { X } from "react-native-feather";
import { PageItem } from './search-tab';
import {
  ImageBackground as ExpoImageBackground,
  ImageBackgroundProps,
} from 'expo-image';
import { VerificationBadge } from './verification-badge';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome'
import { faLock } from '@fortawesome/free-solid-svg-icons/faLock'
import { useOnline } from '../chat/application-layer/hooks/online';
import { useSkipped } from '../hide-and-block/hide-and-block';
import { OnlineIndicator } from './online-indicator';
import { useAppTheme } from '../app-theme/app-theme';
import { setProspectHint } from '../navigation/prospect-cache';

// This component wouldn't need to exist if expo-image (and expo itself (and the
// JS eco system generally)) wasn't buggy trash. This fixes an issue on
// in expo on Android where the images flicker when being loaded in a flat list.
// The React Native ImageBackground implementation doesn't have that issue, but
// it also doesn't support blurhashes, so we need to combine them if we want to
// have blurhashes and (the appearance of) bug-free operation
const ImageBackground = (
  props: Omit<ImageBackgroundProps, 'onLoad'> & { onLoad?: () => void },
) => {
  if (Platform.OS !== 'android') {
    return <ExpoImageBackground {...props} />;
  }

  const {
    children,
    placeholder,
    source,
    style,
    transition,
    contentFit,
    onLoad,
  } = props;

  const resizeMode: ImageResizeMode =
    contentFit === 'cover' ? 'cover' :
    contentFit === 'fill' ? 'stretch' :
    'contain';

  const fadeDuration =
    typeof transition === 'number' ? transition : transition?.duration;

  const rnSource: ImageSourcePropType | undefined =
    typeof source === 'number' ? source :
    (!!source && typeof source === 'object' && 'uri' in source &&
      typeof source.uri === 'string') ? { uri: source.uri } :
    undefined;

  return (
    <ExpoImageBackground
      placeholder={placeholder}
      transition={transition}
      style={style}
      contentFit={contentFit}
      placeholderContentFit={contentFit}
    >
      <RNImageBackground
        source={rnSource}
        style={{
          width: '100%',
          height: '100%',
        }}
        resizeMode={resizeMode}
        fadeDuration={fadeDuration}
        onLoad={onLoad}
      >
        {children}
      </RNImageBackground>
    </ExpoImageBackground>
  );
};

const PhotoOrSkeleton_ = ({
  resolution,
  photoUuid,
  photoBlurhash,
  forceExpoImage = false,
  onLoad,
  ...rest
}: {
  resolution: number,
  photoUuid: string | undefined | null,
  photoBlurhash: string | undefined | null,
  photoExtraExts?: string[] | null,
  showGradient?: boolean,
  forceExpoImage?: boolean,
  style?: StyleProp<ViewStyle>,
  onLoad?: () => void,
}) => {
  const {
    photoExtraExts = [],
    showGradient = true,
  } = rest;

  const { appTheme } = useAppTheme();

  const uri = photoUri(photoUuid, resolution, photoExtraExts);

  // This is a workaround for an issue where images that are only blurhashes
  // appear as blank. I'm guessing the root cause is another issue I vaguely
  // remember in React Native, where animations can be blocked by the rendering
  // of a flat list.
  const transition = !photoUuid ? { duration: 0, effect: null } : 150;

  // `ImageBackground` is a workaround that breaks gifs on prospect profiles in
  // order to fix flickering while scrolling through the search tab. That
  // workaround is to avoid using `ImageBackground` from `expo-image`
  // (AKA `ExpoImageBackground`) `expo-image` is one of the buggiest pieces of
  // software I've used in my life, though it comes with more features than
  // vanilla React Native.
  const ImageBackground_ = useMemo(
    () => forceExpoImage ? ExpoImageBackground : ImageBackground,
    [forceExpoImage]
  );

  return (
    <ImageBackground_
      source={uri && { uri: uri }}
      placeholder={photoBlurhash && { blurhash: photoBlurhash }}
      transition={transition}
      style={{
          width: '100%',
          aspectRatio: 1,
          backgroundColor: photoUuid ? undefined : appTheme.avatarBackgroundColor,
          ...noSelect,
      }}
      contentFit="contain"
      placeholderContentFit="contain"
      onLoad={onLoad}
      recyclingKey={photoUuid}
    >
      <LinearGradient
        colors={showGradient ? [
          'transparent',
          'rgba(0, 0, 0, 0.5)',
        ] : [
          'transparent',
          'transparent',
        ]}
        locations={[
          0.7,
          1.0,
        ]}
        style={{
          height: '100%',
          justifyContent: 'center',
          alignItems: 'center',
          ...noSelect,
        }}
        dither={false}
      >
        {photoUuid === null && photoBlurhash === null &&
          <Ionicons
            style={{ fontSize: 100, color: appTheme.avatarColor }}
            name={'person'}
          />
        }
      </LinearGradient>
    </ImageBackground_>
  );
};

const PhotoOrSkeleton = memo(PhotoOrSkeleton_);

const ProfileCard = ({
  item,
}: {
  item: PageItem,
}) => {
  const {
    name: name,
    age: age,
    match_percentage: matchPercentage,
    profile_photo_uuid: photoUuid,
    profile_photo_blurhash: photoBlurhash,
    prospect_uuid: personUuid,
    url_slug: urlSlug,
    person_messaged_prospect: personMessagedProspect,
    prospect_messaged_person: prospectMessagedPerson,
    verified: verified,
    verification_required_to_view: verificationRequired,
  } = item;

  const { appTheme } = useAppTheme();

  // Profile links prefer the username (url_slug), falling back to the uuid.
  const handle = urlSlug || personUuid;

  const { isSkipped, wasPostSkipFiredInThisSession } = useSkipped(personUuid);

  const { status: onlineStatus } = useOnline(personUuid);

  const [
    personMessagedProspectState,
    setPersonMessagedProspectState,
  ] = useState(personMessagedProspect);
  const [
    prospectMessagedPersonState,
    setProspectMessagedPersonState,
  ] = useState(prospectMessagedPerson);

  const navigation = useNavigation<CompositeNavigationProp<
    NavigationProp<HomeParamList>,
    NavigationProp<RootParamList>
  >>();

  const itemOnPress = useCallback((e: GestureResponderEvent) => {
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
  }, [navigation, personUuid, handle, verificationRequired, photoBlurhash]);

  const onMessageFrom = useCallback(
    () => {
      setProspectMessagedPersonState(true);
      item.prospect_messaged_person = true;
    },
    [setProspectMessagedPersonState, item]
  );

  const onMessageTo = useCallback(
    () => {
      setPersonMessagedProspectState(true);
      item.person_messaged_prospect = true;
    },
    [setPersonMessagedProspectState, item]
  );

  useEffect(
    () => listen(`message-from-${personUuid}`, onMessageFrom),
    [personUuid, onMessageFrom]
  );

  useEffect(
    () => listen(`message-to-${personUuid}`, onMessageTo),
    [personUuid, onMessageTo]
  );

  const link = navigation && !verificationRequired && personUuid ? makeLinkProps(`/${handle}`)
                                                                 : {};

  return (
    <Pressable
      onPress={itemOnPress}
      style={{ flex: 0.5, aspectRatio: 1, overflow: 'hidden', borderRadius: 5 }}
      {...link}
    >
      <View
        style={{
          width: '100%',
          height: '100%',
          borderBottomRightRadius: onlineStatus !== 'offline' ? 24 : undefined,
          overflow: 'hidden',
        }}
      >
        <PhotoOrSkeleton
          resolution={450}
          photoUuid={photoUuid}
          photoBlurhash={photoBlurhash}
        />
        <UserDetails
          name={name}
          age={age}
          matchPercentage={matchPercentage}
          verified={verified}
        />
        {onlineStatus === 'offline' && prospectMessagedPersonState &&
          <View
            style={{
              position: 'absolute',
              bottom: 6,
              right: 26,
              width: 18,
              height: 18,
            }}
          >
            <Ionicons
              style={{ fontSize: 18, color: 'white' }}
              name="chatbubble"
            />
          </View>
        }
        {onlineStatus === 'offline' && personMessagedProspectState &&
          <View
            style={{
              transform: [ { scaleX: -1 } ],
              position: 'absolute',
              bottom: 6,
              right: 6,
              width: 18,
              height: 18,
            }}
          >
            <Ionicons
              style={{ fontSize: 18, color: 'white' }}
              name="chatbubble"
            />
          </View>
        }
      </View>
      <OnlineIndicator
        personUuid={personUuid}
        size={24}
        borderWidth={4}
        style={{
          position: 'absolute',
          bottom: -4,
          right: -4,
        }}
      />
      {isSkipped && wasPostSkipFiredInThisSession &&
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
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <FontAwesomeIcon
            icon={faLock}
            size={30}
            style={{color: 'white'}}
          />
          <DefaultText
            style={{
              color: 'white',
              fontWeight: '900',
              fontSize: 22,
              textAlign: 'center',
              padding: 10,
            }}
          >
            Verification Required
          </DefaultText>
          <DefaultText
            style={{
              fontSize: 12,
              color: '#ccc',
              textAlign: 'center',
              paddingHorizontal: 10,
            }}
          >
            This person only lets people with
            verified {verificationRequired} see them
          </DefaultText>
        </View>
      }
    </Pressable>
  );
};

const UserDetails = ({name, age, matchPercentage, verified, ...rest}: {
  name: string,
  age: number,
  matchPercentage: number,
  verified: boolean,
  containerStyle?: ViewStyle,
}) => {
  const {
    containerStyle,
  } = rest;

  return (
    <View
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        width: '100%',
        padding: 5,
        gap: 2,
        ...containerStyle,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          gap: 7,
          alignItems: 'flex-end',
        }}
      >
        <DefaultText style={{
          fontSize: 18,
          fontWeight: '700',
          color: 'white',
          overflow: 'hidden',
          flexShrink: 1,
        }}>
          {name}{age && `, ${age}`}
        </DefaultText>
        {verified &&
          <VerificationBadge
            size={18}
            style={{
              marginBottom: 2,
            }}
          />
        }
      </View>
      <DefaultText
        style={{
          fontWeight: '500',
          color: 'white',
          alignSelf: 'flex-start',
        }}
      >
        {matchPercentage}% Match
      </DefaultText>
    </View>
  );
};

export {
  PhotoOrSkeleton,
  ProfileCard,
};
