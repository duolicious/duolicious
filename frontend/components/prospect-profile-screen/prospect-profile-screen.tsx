import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  TextStyle,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Fragment,
  MutableRefObject,
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  NativeStackNavigationProp,
  NativeStackScreenProps,
  createNativeStackNavigator,
} from '@react-navigation/native-stack';
import { CompositeNavigationProp, CompositeScreenProps } from '@react-navigation/native';
import type { ProspectParamList, RootParamList } from '../../navigation/linking';
import { LogoActivityIndicator } from '../logo/logo-activity-indicator';
import { DefaultText } from '../default-text';
import { DonutChart } from '../donut-chart';
import { Title } from '../title';
import {
  lookingForDescription,
  lookingForEmoji,
} from './looking-for';
import { InDepthScreen } from '../in-depth-screen';
import { ButtonWithCenteredText } from '../button/centered-text';
import { api } from '../../api/api';
import { cmToFeetInchesStr } from '../../units/units';
import { useSignedInUser } from '../../events/signed-in-user';
import { postSkipped } from '../../hide-and-block/hide-and-block';
import { Basic, Basics } from '../basic';
import { themedSurface, legibleSurface } from '../../app-theme/surface';
import { Club, Clubs } from '../club';
import { Stat, Stats } from '../stat';
import { listen, notify } from '../../events/events';
import { useBackButtonClaim } from '../../events/back-button';
import { COLUMN_MAX_WIDTH } from '../../constants/constants';
import { ReportModalInitialData } from '../modal/report-modal';
import { getProspectHint, setProspectHint } from '../../navigation/prospect-cache';
import { setBannerProspectName } from '../../events/banner-prospect-name';
import {
  VerificationBadge,
  DetailedVerificationBadges,
} from '../verification-badge';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome'
import { faRulerVertical } from '@fortawesome/free-solid-svg-icons/faRulerVertical'
import { faHandsPraying } from '@fortawesome/free-solid-svg-icons/faHandsPraying'
import { faPills } from '@fortawesome/free-solid-svg-icons/faPills'
import { faSmoking } from '@fortawesome/free-solid-svg-icons/faSmoking'
import { faPaperPlane } from '@fortawesome/free-solid-svg-icons/faPaperPlane'
import { faReply } from '@fortawesome/free-solid-svg-icons/faReply'
import { faLocationDot } from '@fortawesome/free-solid-svg-icons/faLocationDot'
import { faUser } from '@fortawesome/free-solid-svg-icons/faUser'
import { RotateCcw, Flag, X, Share2 } from "react-native-feather";
import Reanimated, {
  Easing,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { ClubItem, joinClub, leaveClub } from '../../club/club';
import * as _ from 'lodash';
import { friendlyTimeAgo, possessive, bestTextOn, capLuminance, isUuid } from '../../util/util';
import { useOnline } from '../../chat/application-layer/hooks/online';
import { HeartBackground } from '../heart-background';
import { AudioPlayer } from '../audio-player';
import { EnlargeablePhoto } from '../enlargeable-image';
import type { PhotoGeometry } from '../../util/photos';
import type { AlbumPhoto } from '../../events/expanded-photo';
import { commonStyles } from '../../styles';
import { useSkipped, setSkipped } from '../../hide-and-block/hide-and-block';
import { OnlineIndicator } from '../online-indicator';
import { Flair } from '../badges';
import { useAppTheme } from '../../app-theme/app-theme';
import { faChild } from '@fortawesome/free-solid-svg-icons/faChild'
import { faChildren } from '@fortawesome/free-solid-svg-icons/faChildren'
import { AboutText } from './about-reply';
import { useQuote } from '../conversation-screen/quote';
import { copyProfileLink } from '../../util/util';

// The person's photos in order, so tapping any one lets the gallery page
// through the rest.
const buildAlbum = (
  uuids: string[] | undefined,
  extraExts: string[][] | undefined,
  geometries: (PhotoGeometry | null)[] | undefined,
  blurhashes: string[] | undefined,
): AlbumPhoto[] =>
  (uuids ?? []).map((uuid, i) => ({
    uuid,
    extraExts: extraExts?.[i] ?? [],
    geometry: geometries?.[i] ?? null,
    blurhash: blurhashes?.[i] ?? null,
  }));

const primaryPhotoBigScreenRadii = { bottomLeft: 12, bottomRight: 12 };

type ProspectNavigation = NativeStackNavigationProp<ProspectParamList>;
type ProspectNavigationRef = MutableRefObject<ProspectNavigation | undefined>;

type ProspectScreenNavigation = CompositeNavigationProp<
  NativeStackNavigationProp<ProspectParamList>,
  NativeStackNavigationProp<RootParamList>
>;
type ProspectScreenProps = CompositeScreenProps<
  NativeStackScreenProps<ProspectParamList, 'Prospect Profile'>,
  NativeStackScreenProps<RootParamList>
>;

const Stack = createNativeStackNavigator();

const ProspectProfileScreen = () => {
  const navigationRef = useRef<ProspectNavigation | undefined>(undefined);

  const ProspectProfileScreen_ = useMemo(() => {
    return Content(navigationRef);
  }, [navigationRef]);

  const InDepthScreen_ = useMemo(() => {
    return InDepthScreen(navigationRef);
  }, [navigationRef]);

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        presentation: 'card',
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Prospect Profile" component={ProspectProfileScreen_} />
      <Stack.Screen name="In-Depth" component={InDepthScreen_} />
    </Stack.Navigator>
  );
};

const profilePillButtonStyle = (
  surface: ReturnType<typeof legibleSurface>,
  pressed: boolean,
): ViewStyle => ({
  marginTop: 100,
  alignSelf: 'center',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 7,
  paddingVertical: 8,
  paddingHorizontal: 14,
  borderWidth: 1,
  borderBottomWidth: 3,
  borderRadius: 999,
  backgroundColor: surface.backgroundColor,
  borderColor: surface.borderColor,
  opacity: pressed ? 0.6 : 1,
});

const profilePillButtonTextStyle = (
  surface: ReturnType<typeof legibleSurface>,
): TextStyle => ({
  overflow: 'hidden',
  textAlign: 'center',
  color: surface.color,
});

const ShareButton = ({personUuid, backgroundColor}: {
  personUuid: string | undefined,
  backgroundColor: string,
}) => {
  const onPress = useCallback(() => {
    copyProfileLink(personUuid);
  }, [personUuid]);

  const surface = legibleSurface(backgroundColor);

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel="Copy profile link"
      style={({ pressed }) => ({
        ...profilePillButtonStyle(surface, pressed),
        marginBottom: 0,
      })}
    >
      <Share2
        stroke={surface.color}
        strokeWidth={2}
        height={18}
        width={18}
      />
      <DefaultText style={profilePillButtonTextStyle(surface)}>
        Share profile
      </DefaultText>
    </Pressable>
  );
};

const FloatingProfileInteractionButton = ({
  children,
  onPress,
  backgroundColor,
}: {
  children: ReactNode,
  onPress: () => void,
  backgroundColor: string,
}) => {
  const { appTheme } = useAppTheme();

  const ref = useRef<View>(null);

  // On web, pressing a non-editable element collapses the current text
  // selection (its default `mousedown` behavior). That wipes the quote derived
  // from the selected profile text before `onPress` can navigate. Prevent the
  // default so the selection survives the press.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = ref.current as unknown as HTMLElement | null;
    if (!node) return;
    const onMouseDown = (e: MouseEvent) => e.preventDefault();
    node.addEventListener('mousedown', onMouseDown);
    return () => node.removeEventListener('mousedown', onMouseDown);
  }, []);

  const opacity = useRef(new Animated.Value(1)).current;

  const fadeOut = useCallback(() => {
    Animated.timing(opacity, {
      toValue: 0.4,
      duration: 0,
      useNativeDriver: false,
    }).start();
  }, []);

  const fadeIn = useCallback(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 50,
      useNativeDriver: false,
    }).start();
  }, []);

  return (
    <Pressable
      ref={ref}
      style={{
        borderRadius: 999,
        zIndex: 999,
        marginLeft: 20,
        marginRight: 20,
        marginBottom: 14,
        marginTop: 14,
      }}
      onPressIn={fadeOut}
      onPressOut={fadeIn}
      onPress={onPress}
    >
      <Animated.View
        style={{
          borderRadius: 999,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: backgroundColor,
          opacity: opacity,
          flexDirection: 'row',
          borderWidth: 1,
          borderColor: appTheme.secondaryColor,
          height: 60,
          width: 60,
        }}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
};

const FloatingSkipButton = ({personUuid}: {
  personUuid: string | null | undefined,
}) => {
  const { isSkipped, isLoading, isPosting } = useSkipped(personUuid);
  const { appTheme } = useAppTheme();

  const onPress = useCallback(async () => {
    if (personUuid == null) return;
    if (isLoading) return;

    const nextIsSkippedState = !isSkipped;

    await postSkipped(personUuid, nextIsSkippedState);
  }, [isLoading, isSkipped, personUuid]);

  return (
    <FloatingProfileInteractionButton
      onPress={onPress}
      backgroundColor={appTheme.primaryColor}
    >
      {isPosting &&
        <LogoActivityIndicator size="medium" color={appTheme.brandColor} />
      }
      {!isLoading && isSkipped === true && <RotateCcw
          stroke={appTheme.brandColor}
          strokeWidth={3}
          height={24}
          width={24}
        />
      }
      {!isLoading && isSkipped === false && <X
          stroke={appTheme.brandColor}
          strokeWidth={3}
          height={24}
          width={24}
        />
      }
    </FloatingProfileInteractionButton>
  );
};

const FloatingSendIntroButton = ({
  navigation,
  personUuid,
  name,
  photoUuid,
  photoBlurhash,
}: {
  navigation: ProspectScreenNavigation,
  personUuid: string | null | undefined,
  name: string | undefined,
  photoUuid: string | null | undefined,
  photoBlurhash: string | null | undefined,
}) => {
  const { appTheme } = useAppTheme();

  const quote = useQuote();

  const onPress = useCallback(() => {
    if (personUuid == null) return;
    if (name === undefined) return;

    setProspectHint(personUuid, { name, photoUuid, photoBlurhash });
    navigation.navigate('Conversation Screen', { personUuid });
  }, [navigation, personUuid, name, photoUuid, photoBlurhash]);

  return (
    <FloatingProfileInteractionButton
      onPress={onPress}
      backgroundColor={appTheme.brandColor}
    >
      {personUuid !== undefined && name !== undefined &&
        <FontAwesomeIcon
          icon={quote ? faReply : faPaperPlane}
          size={24}
          style={{
            color: appTheme.primaryColor,
            // @ts-ignore
            outline: 'none',
          }}
        />
      }
    </FloatingProfileInteractionButton>
  );
};

const AnonymousSignInCta = ({navigation, name}: {
  navigation: ProspectScreenNavigation,
  name: string | undefined,
}) => {
  const { appTheme } = useAppTheme();
  const insets = useSafeAreaInsets();

  // Push Welcome (don't `reset`) so the system back button still points at
  // the profile and the user can bail out of sign-in.
  const onPress = useCallback(() => {
    navigation.navigate('Welcome');
  }, [navigation]);

  return (
    <View
      style={{
        position: 'absolute',
        bottom: insets.bottom,
        width: '100%',
        maxWidth: COLUMN_MAX_WIDTH,
        alignSelf: 'center',
        zIndex: 999,
        paddingLeft: 20,
        paddingRight: 20,
        paddingBottom: 14,
        paddingTop: 14,
      }}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={onPress}
        style={{
          backgroundColor: appTheme.brandColor,
          borderRadius: 999,
          paddingVertical: 16,
          paddingHorizontal: 20,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 10,
          borderWidth: 1,
          borderColor: appTheme.secondaryColor,
        }}
      >
        <FontAwesomeIcon
          icon={faPaperPlane}
          size={18}
          style={{ color: appTheme.primaryColor }}
        />
        <DefaultText
          style={{
            color: appTheme.primaryColor,
            fontWeight: '700',
            fontSize: 16,
            textAlign: 'center',
          }}
        >
          {name === undefined
            ? 'Sign up to send a message'
            : `Sign up to message ${name}`}
        </DefaultText>
      </Pressable>
    </View>
  );
};

const SeeQAndAButton = ({navigation, personUuid, name}: {
  navigation: ProspectScreenNavigation,
  personUuid: string | null | undefined,
  name: string | undefined,
}) => {
  const containerStyle = useRef({
    marginTop: 40,
    marginLeft: 10,
    marginRight: 10,
  }).current;
  const textStyle = useRef({
    marginLeft: 35,
    marginRight: 35,
  }).current;
  const iconContainerStyle = useRef<StyleProp<ViewStyle>>({
    position: 'absolute',
    top: 0,
    right: 15,
    height: '100%',
    justifyContent: 'center',
  }).current;
  const iconStyle = useRef<StyleProp<TextStyle>>({
    fontSize: 20,
    color: 'white',
  }).current;
  const extraChildren = useRef(
    <View style={iconContainerStyle}>
      <Ionicons style={iconStyle} name="chevron-forward"/>
    </View>
  ).current;

  const onPress = useCallback(() => {
    if (!personUuid) return;
    navigation.navigate('In-Depth', { personUuid });
  }, [personUuid]);

  return (
    <ButtonWithCenteredText
      containerStyle={containerStyle}
      textStyle={textStyle}
      onPress={onPress}
      extraChildren={extraChildren}
      loading={name === undefined}
      borderColor="rgba(255, 255, 255, 0.2)"
      borderWidth={1}
    >
      {possessive(String(name))} Q&A Answers
    </ButtonWithCenteredText>
  );
};

const BlockButton = ({name, personUuid, backgroundColor}: {
  name: string | undefined,
  personUuid: string | null | undefined,
  backgroundColor: string,
}) => {
  const { isSkipped, isLoading, isPosting } = useSkipped(personUuid);
  const surface = legibleSurface(backgroundColor);

  const onPress = useCallback(async () => {
    if (personUuid == null) return;

    if (isSkipped) {
      await postSkipped(personUuid, false);
    } else {
      if (name === undefined) return;

      const data: ReportModalInitialData = {
        name,
        personUuid,
        context: 'Prospect Profile Screen',
      };
      notify('open-report-modal', data);
    }
  }, [notify, name, personUuid, isSkipped]);

  const text = isSkipped ?
    `You have skipped ${name}. Press to unskip.` :
    `Report ${name}`;

  const iconStroke = isLoading ? "transparent" : surface.color;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        ...profilePillButtonStyle(surface, pressed),
        marginBottom: 100,
      })}
    >
      {isPosting &&
        <LogoActivityIndicator size="small" color="#70f"/>
      }
      {!isLoading && isSkipped &&
        <RotateCcw
          stroke={iconStroke}
          strokeWidth={2}
          height={18}
          width={18}
        />
      }
      {!isLoading && !isSkipped &&
        <Flag
          stroke={iconStroke}
          strokeWidth={2}
          height={18}
          width={18}
        />
      }
      {!isLoading &&
        <DefaultText style={profilePillButtonTextStyle(surface)}>
          {name === undefined ? '...' : text}
        </DefaultText>
      }
    </Pressable>
  );
};

type AllClubsChild =
  | { kind: 'Title', kids: ReactNode, props: { style?: TextStyle } }
  | { kind: 'Club', kids: ReactNode, props: {
      onPress?: () => void,
      key: string,
      name: string,
      isMutual: boolean,
      style?: ViewStyle,
      textStyle?: TextStyle,
    } };

const AllClubsItem = ({child}: {child: AllClubsChild}) => {
  if (child.kind === 'Title') {
    return <Title style={child.props.style}>{child.kids}</Title>;
  }

  return (
    <Club
      name={child.props.name}
      isMutual={child.props.isMutual}
      style={child.props.style}
      textStyle={child.props.textStyle}
      onPress={child.props.onPress}
    />
  );
};

const AllClubs = ({
  mutualClubs,
  otherClubs,
  mutualClubsTheme,
  clubsTheme,
  titleColor,
}: {
  mutualClubs: string[],
  otherClubs: string[],
  mutualClubsTheme: { style?: ViewStyle, textStyle?: TextStyle },
  clubsTheme: { style?: ViewStyle, textStyle?: TextStyle },
  titleColor: string | undefined,
}) => {
  const [signedInUser] = useSignedInUser();
  const [state, setState] = useState({
    mutualClubs: mutualClubs,
    otherClubs: otherClubs,
  });

  useEffect(() => {
    setState({ mutualClubs, otherClubs })
  }, [mutualClubs, otherClubs]);

  useEffect(() =>
    listen<ClubItem[]>(
      'updated-clubs',
      (cs) => {
        if (!cs) {
          return;
        }

        setState(s => {
          const clubs = [...new Set(cs.map(c => c.name))];
          const prospectClubs = [...new Set([...s.otherClubs, ...s.mutualClubs])];

          return {
            mutualClubs: [..._.intersection(clubs, prospectClubs)],
            otherClubs: [..._.difference(prospectClubs, clubs)],
          }
        });
      }
    )
  , []);

  if (state.mutualClubs.length === 0 && state.otherClubs.length === 0) {
    return null;
  }

  // join/leave hit authenticated endpoints, so anon viewers see clubs but
  // can't interact with them.
  const onPressLeave = signedInUser
    ? (clubName: string) => leaveClub(clubName)
    : undefined;
  const onPressJoin = signedInUser
    ? (clubName: string) => joinClub(clubName, -1, false)
    : undefined;

  const childData: (AllClubsChild | null)[] = [
    state.mutualClubs.length > 0 ? {
      kind: 'Title',
      props: { style: {color: titleColor, width: '100%'}},
      kids: 'Mutual clubs' } : null,

    ...state.mutualClubs.map((clubName): AllClubsChild => ({
        kind: 'Club',
        props: {
          onPress: onPressLeave && (() => onPressLeave(clubName)),
          key: clubName,
          name: clubName,
          isMutual: true,
          ...mutualClubsTheme,
        },
        kids: null,
      })),

      (state.otherClubs.length > 0 && state.mutualClubs.length > 0) ? {
        kind: 'Title',
        props: { style: {color: titleColor, width: '100%'}},
        kids: 'Other clubs' } : null,

      (state.otherClubs.length > 0 && state.mutualClubs.length === 0) ? {
        kind: 'Title',
        props: { style: {color: titleColor, width: '100%'}},
        kids: 'Clubs' } : null,

      ...state.otherClubs.map((clubName): AllClubsChild => ({
        kind: 'Club',
        props: {
          onPress: onPressJoin && (() => onPressJoin(clubName)),
          key: clubName,
          name: clubName,
          isMutual: false,
          ...clubsTheme,
        },
        kids: null,
      })),
  ];

  return (
    <Clubs>
      {childData.filter((c): c is AllClubsChild => c !== null).map((d) =>
        <Reanimated.View
          key={
            JSON.stringify({
              kind: d.kind,
              kids: d.kids,
              clubName: d.kind === 'Club' ? d.props.name : undefined,
            })
          }
          style={d.kind === 'Title' ? styles.wFull : null}
          layout={LinearTransition.easing(Easing.out(Easing.poly(4)))}
          exiting={FadeOut}
        >
          <AllClubsItem child={d} />
        </Reanimated.View>
      )}
    </Clubs>
  );
};

type UserData = {
  name: string,
  url_slug: string,
  person_uuid: string,
  about: string,
  mutual_clubs: string[],
  other_clubs: string[],
  gender: string,
  match_percentage: number | null,
  photo_uuids: string[],
  photo_extra_exts: string[][],
  photo_blurhashes: string[],
  photo_verifications: boolean[],
  photo_geometries: (PhotoGeometry | null)[],
  audio_bio_uuid: string | null,
  age: number | null,
  location: string | null
  drinking: string | null,
  drugs: string | null,
  ethnicity: string | null,
  exercise: string | null,
  has_kids: string | null,
  height_cm: number | null,
  long_distance: string | null,
  looking_for: string | null,
  gender_preference: string[] | null,
  age_preference: { min_age: number | null, max_age: number | null } | null,
  show_my_looking_for: string | null,
  occupation: string | null,
  education: string | null,
  orientation: string | null,
  relationship_status: string | null,
  religion: string | null,
  smoking: string | null,
  star_sign: string | null,
  wants_kids: string | null,
  is_skipped: boolean,
  person_id: number,

  verified_age: boolean,
  verified_gender: boolean,
  verified_ethnicity: boolean,

  theme: {
    title_color: string,
    body_color: string,
    background_color: string,
  }

  flair: string[]

  // Stats
  count_answers: number | null,
  seconds_since_last_online: number | null,
  seconds_since_sign_up: number | null,
  gets_reply_percentage: number | null,
  gives_reply_percentage: number | null,
};

const verificationLevelId = (data: UserData | null | undefined): 1 | 2 | 3 => {
  // This should be provided by the backend instead

  if (!data) {
    return 1;
  }

  const hasVerifiedBasics = data.verified_gender && data.verified_age;
  const hasVerififiedPhotos = data.photo_verifications.some(Boolean);

  if (hasVerifiedBasics && hasVerififiedPhotos) {
    return 3;
  }

  if (hasVerifiedBasics) {
    return 2;
  }

  return 1;
};

const verifiedAnything = (data: UserData | null | undefined): boolean => {
  if (!data) {
    return false;
  }

  return Boolean(
    data.photo_verifications.some(Boolean) ||
    data.verified_gender ||
    data.verified_age ||
    data.verified_ethnicity
  );
};

const hasAnyStats = (data: UserData | null | undefined): boolean => {
  if (data === undefined) {
    return true;
  }

  if (data === null) {
    return true;
  }

  return (
    data.count_answers !== null ||
    data.seconds_since_last_online !== null ||
    data.seconds_since_sign_up !== null ||
    data.gets_reply_percentage !== null ||
    data.gives_reply_percentage !== null
  );
};

// Whether any Basics pill would render. Returns true while data is still
// loading so the section doesn't flicker in once the response lands.
const hasAnyBasics = (data: UserData | null | undefined): boolean => {
  if (data === undefined || data === null) {
    return true;
  }

  return Boolean(
    data.orientation ||
    data.ethnicity ||
    data.relationship_status ||
    data.occupation ||
    data.education ||
    data.has_kids ||
    data.wants_kids ||
    data.smoking ||
    data.drinking ||
    data.drugs ||
    data.religion ||
    data.star_sign ||
    data.exercise ||
    data.height_cm
  );
};

const Content = (navigationRef: ProspectNavigationRef) =>  {
  return (props: ProspectScreenProps) => <CurriedContent
    navigationRef={navigationRef}
    {...props}
  />;
};

const CurriedContent = ({navigationRef, navigation, route}: ProspectScreenProps & {
  navigationRef: ProspectNavigationRef,
}) => {
  navigationRef.current = navigation;

  const insets = useSafeAreaInsets();

  // The route param is a "handle": either a uuid (legacy/shared links) or a
  // url_slug. It drives the URL, the initial fetch and the caller-supplied
  // hints (all keyed by whatever the caller navigated with). Uuid-keyed actions
  // (skip, online presence, chat) instead need the *canonical* uuid, which we
  // read from the fetched profile (`data.person_uuid`); when the handle is
  // already a uuid we can use it immediately, otherwise it resolves once `data`
  // lands.
  const handle = route.params.personUuid;

  const [signedInUser] = useSignedInUser();
  const [data, setData] = useState<UserData | undefined>(undefined);

  const personUuid = data?.person_uuid ?? (isUuid(handle) ? handle : undefined);

  // `showBottomButtons` and `photoBlurhash` are intentionally NOT route params:
  // the former is derived from who's signed in (plus an optional one-shot
  // hint from the caller), the latter is an optimistic rendering hint stashed
  // in prospect-cache by the navigating caller. This keeps URLs clean
  // (`/:username`) and navigation state serializable.
  const hint = getProspectHint(handle);
  const isViewingSelf =
    !!signedInUser?.personUuid && (
      signedInUser.personUuid === personUuid ||
      signedInUser.personUuid === handle);
  const isAnonymousViewer = !signedInUser;

  useBackButtonClaim(
    !isAnonymousViewer || Platform.OS === 'web'
      ? {
        layout: 'column',
        transition: Platform.OS === 'web' ? 'instant' : 'fade',
        onPress: () => navigationRef.current?.goBack(),
      }
      : null
  );
  // Consume the `hideBottomButtons` hint when a new handle lands here so a
  // later visit from a different context (e.g. tapping the same person's
  // avatar in search) gets the default behaviour rather than inheriting a
  // stale conversation hint. Tracked in state because the same screen
  // instance can be reused with a different `handle` without remount.
  // Initialised lazily from the cache to avoid a one-frame flash of the
  // bottom buttons before the consuming effect runs.
  const [hideBottomButtonsHint, setHideBottomButtonsHint] = useState(
    () => !!getProspectHint(handle)?.hideBottomButtons,
  );
  useEffect(() => {
    const h = getProspectHint(handle);
    if (h?.hideBottomButtons) {
      setHideBottomButtonsHint(true);
      setProspectHint(handle, { hideBottomButtons: false });
    } else {
      setHideBottomButtonsHint(false);
    }
  }, [handle]);

  const showAuthedBottomButtons =
    !isAnonymousViewer && !isViewingSelf && !hideBottomButtonsHint;
  const photoBlurhashParam = hint?.photoBlurhash;

  const { appThemeName, appTheme } = useAppTheme();
  // Wait for `data` to resolve so the CTA doesn't briefly flash before
  // `notFound` flips on for 404'd profiles.
  const showAnonymousSignInCta =
    isAnonymousViewer && !!data && !hideBottomButtonsHint;
  const personId = data?.person_id;
  const [notFound, setNotFound] = useState(false);
  useSkipped(personUuid, () => navigation.popToTop());

  // Surface the prospect's name in the browser tab. We prefer the freshly
  // fetched name but fall back to the optimistic hint while the API is in
  // flight so the title doesn't briefly read "Duolicious" before snapping
  // to the name. App.tsx's `documentTitle.formatter` reads `options.title`.
  const screenTitle = data?.name ?? getProspectHint(handle)?.name;
  useLayoutEffect(() => {
    navigation.setOptions({ title: screenTitle });
    setBannerProspectName(handle, screenTitle);
  }, [navigation, handle, screenTitle]);

  const { width } = useWindowDimensions();

  useEffect(() => {
    setData(undefined);
    setNotFound(false);
    (async () => {
      // The skip cache is keyed by the canonical uuid. When the handle is a
      // uuid we can show the "fetching" state immediately; for a slug we settle
      // it once the profile (which carries `person_uuid`) lands.
      if (isUuid(handle)) {
        setSkipped(handle, { networkState: 'fetching' });
      }
      const response = await api<UserData>('get', `/prospect-profile/${handle}`);
      setData(response?.json);
      setNotFound(response.clientError);
      const canonicalUuid = response?.json?.person_uuid ?? (
        isUuid(handle) ? handle : undefined);
      if (canonicalUuid) {
        setSkipped(
          canonicalUuid,
          {
            isSkipped: response?.json?.is_skipped ?? false,
            networkState: 'settled',
          }
        );
        // Make `personId` / `name` available to sibling screens (e.g. In-Depth,
        // navigated to by the canonical uuid) so they don't have to refetch
        // this endpoint just to resolve the numeric id required by `/compare-*`
        // APIs.
        setProspectHint(canonicalUuid, {
          personId: response.json.person_id,
          name: response.json.name,
        });
      }
    })();
  }, [handle]);

  const photoUuid = data === undefined ?
    undefined :
    data.photo_uuids.length === 0 ?
    null :
    data.photo_uuids[0];

  const photoUuids = data?.photo_uuids;

  const photoExtraExts = data?.photo_extra_exts;

  const photoBlurhashes = data?.photo_blurhashes;

  const imageVerifications = data?.photo_verifications;

  const album = useMemo(
    () => buildAlbum(
      data?.photo_uuids,
      data?.photo_extra_exts,
      data?.photo_geometries,
      data?.photo_blurhashes,
    ),
    [
      data?.photo_uuids,
      data?.photo_extra_exts,
      data?.photo_geometries,
      data?.photo_blurhashes,
    ],
  );

  const photoUuid0 = (() => {
    if (photoUuids === undefined) {
      return undefined;
    }
    if (photoUuids.length === 0) {
      return null;
    }
    return photoUuids[0];
  })();

  const photoExtraExts0 = (() => {
    if (photoExtraExts === undefined) {
      return undefined;
    }
    if (photoExtraExts.length === 0) {
      return null;
    }
    return photoExtraExts[0];
  })();

  const photoBlurhash0 = (() => {
    if (photoBlurhashParam) {
      return photoBlurhashParam;
    }
    if (photoBlurhashes === undefined) {
      return undefined;
    }
    if (photoBlurhashes.length === 0) {
      return null;
    }
    return photoBlurhashes[0];
  })();

  const imageVerification0 = imageVerifications && imageVerifications[0];

  const uncappedBackgroundColor = data?.theme?.background_color
      ?? appTheme.primaryColor;

  const backgroundColor = appThemeName === 'dark'
    ? capLuminance(uncappedBackgroundColor)
    : uncappedBackgroundColor;

  const animatedStyle = useAnimatedStyle(
    () => ({ backgroundColor: withTiming(backgroundColor) }),
    [backgroundColor]
  );

  return (
    <>
      {notFound &&
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#70f',
            paddingHorizontal: 30,
            gap: 14,
          }}
        >
          {/* Anon 404s are ambiguous (private OR nonexistent) so we show a
              sign-in CTA instead of "Profile not found". */}
          <DefaultText
            style={{
              fontWeight: '900',
              fontSize: 26,
              color: appTheme.primaryColor,
              textAlign: 'center',
            }}
          >
            {isAnonymousViewer
              ? 'Sign in to view this profile'
              : 'Profile not found'}
          </DefaultText>
          {isAnonymousViewer &&
            <DefaultText
              style={{
                fontSize: 16,
                color: appTheme.primaryColor,
                opacity: 0.85,
                textAlign: 'center',
              }}
            >
              This profile is only visible to signed-in users, or it may
              not exist.
            </DefaultText>
          }
        </View>
      }
      {!notFound && <>
        <ScrollView style={{ backgroundColor }}>
          <Reanimated.View style={animatedStyle}>
            <HeartBackground
              style={{
                width: '100%',
                height: '100%',
              }}
            >
              <View
                style={{
                  width: '100%',
                  maxWidth: COLUMN_MAX_WIDTH,
                  alignSelf: 'center',
                  paddingBottom:
                    showAnonymousSignInCta && Platform.OS === 'web' ? 200 : 100,
                }}
              >
                <EnlargeablePhoto
                  photoUuid={photoUuid0}
                  photoExtraExts={photoExtraExts0}
                  photoBlurhash={photoBlurhash0}
                  photoGeometry={album[0]?.geometry}
                  album={album}
                  isPrimary={true}
                  isVerified={imageVerification0}
                  borderRadius={
                    width > 600 ?
                    primaryPhotoBigScreenRadii :
                    undefined
                  }
                  style={
                    width > 600 ?
                    commonStyles.primaryEnlargeablePhotoBigScreen :
                    undefined
                  }
                />
                <ProspectUserDetails
                  navigation={navigation}
                  personId={personId}
                  personUuid={personUuid}
                  name={data?.name}
                  age={data?.age}
                  gender={data?.gender}
                  userLocation={data?.location}
                  verified={verificationLevelId(data) > 1}
                  matchPercentage={data?.match_percentage}
                  titleColor={data?.theme?.title_color}
                  bodyColor={data?.theme?.body_color}
                />
                <Body
                  navigation={navigation}
                  personUuid={personUuid}
                  data={data}
                  canReply={showAuthedBottomButtons}
                />
              </View>
            </HeartBackground>
          </Reanimated.View>
        </ScrollView>
        {showAuthedBottomButtons &&
          <View
            style={{
              position: 'absolute',
              bottom: insets.bottom,
              width: '100%',
              maxWidth: COLUMN_MAX_WIDTH,
              alignSelf: 'center',
              zIndex: 999,
              overflow: 'visible',
              justifyContent: 'center',
              flexDirection: 'row',
            }}
            pointerEvents="box-none"
          >
            <View
              style={{
                flexDirection: 'row',
              }}
            >
              <FloatingSkipButton
                personUuid={personUuid}
              />
              <FloatingSendIntroButton
                navigation={navigation}
                personUuid={personUuid}
                name={data?.name}
                photoUuid={photoUuid}
                photoBlurhash={photoBlurhash0}
              />
            </View>
          </View>
        }
        {showAnonymousSignInCta && Platform.OS !== 'web' &&
          <AnonymousSignInCta
            navigation={navigation}
            name={data?.name}
          />
        }
      </>}
    </>
  );
};

const ProspectUserDetails = ({
  navigation,
  personId,
  personUuid,
  name,
  age,
  gender,
  userLocation,
  verified,
  matchPercentage,
  titleColor,
  bodyColor,
}: {
  navigation: ProspectScreenNavigation,
  personId: number | undefined,
  personUuid: string | null | undefined,
  name: string | undefined,
  age: number | null | undefined,
  gender: string | undefined,
  userLocation: string | null | undefined,
  verified: boolean,
  matchPercentage: number | null | undefined,
  titleColor: string | undefined,
  bodyColor: string | undefined,
}) => {
  const { appTheme } = useAppTheme();

  const metaColor = bodyColor ?? appTheme.hintColor;

  const onPressDonutChart = useCallback(() => {
    if (personId === undefined) return;
    if (name === undefined) return;
    if (!personUuid) return;

    navigation.navigate('In-Depth', { personUuid });
  }, [navigation, personUuid, personId, name]);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        margin: 10,
        gap: 10,
      }}
    >
      <View
        style={{
          flexShrink: 1,
          gap: 5,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            flexShrink: 1,
            alignItems: 'center',
            gap: 8,
          }}
        >
          <OnlineIndicator
            personUuid={personUuid}
            size={14}
            borderWidth={1}
          />
          <DefaultText
            style={{
              fontWeight: 900,
              fontSize: 26,
              letterSpacing: -0.5,
              flexShrink: 1,
              color: titleColor,
            }}
          >
            {/* The non-breaking space prevents the UI from jumping around too */}
            {/* much while the content loads */}
            {name ?? '\u00A0'}
          </DefaultText>
          {verified &&
            <VerificationBadge/>
          }
        </View>
        <View style={{ gap: 2 }}>
          <DefaultText
            style={{
              textAlign: 'left',
              fontSize: 15,
              fontWeight: 500,
              color: metaColor,
            }}
          >
            <FontAwesomeIcon
              icon={faUser}
              style={{
                transform: [ { translateY: 2 } ],
              }}
              color={metaColor}
            />
            {'\u2002'}
            {[
              age,
              gender,
            ].filter(Boolean).join(' • ')}
          </DefaultText>
          <DefaultText
            style={{
              textAlign: 'left',
              fontSize: 15,
              fontWeight: 500,
              color: metaColor,
            }}
          >
            <FontAwesomeIcon
              icon={faLocationDot}
              style={{
                transform: [ { translateY: 2 } ],
              }}
              color={metaColor}
            />
            {'\u2002'}
            {userLocation === null ? 'Private location' : userLocation}
          </DefaultText>
        </View>
      </View>
      {/* `null` = backend omitted the score (anon viewer); `undefined` =
          still loading and should render the chart faded. */}
      {matchPercentage !== null &&
        <DonutChart
          percentage={matchPercentage}
          onPress={onPressDonutChart}
          textStyle={{
            color: titleColor,
          }}
        >
          <DefaultText
            style={{
              paddingBottom: 5,
              fontWeight: '500',
              fontSize: 10,
              opacity: matchPercentage === undefined ? 0 : 1,
              color: titleColor,
            }}
          >
            See Why ›
          </DefaultText>
        </DonutChart>
      }
    </View>
  );
};

const Body = ({
  navigation,
  personUuid,
  data,
  canReply = false,
}: {
  navigation: ProspectScreenNavigation,
  personUuid: string | undefined,
  data: UserData | undefined,
  canReply?: boolean,
}) => {
  const { appThemeName, appTheme } = useAppTheme();
  const [signedInUser] = useSignedInUser();
  const isOnline = useOnline(personUuid);

  const album = useMemo(
    () => buildAlbum(
      data?.photo_uuids,
      data?.photo_extra_exts,
      data?.photo_geometries,
      data?.photo_blurhashes,
    ),
    [
      data?.photo_uuids,
      data?.photo_extra_exts,
      data?.photo_geometries,
      data?.photo_blurhashes,
    ],
  );

  const profilePhoto = (position: number) => (
    <EnlargeablePhoto
      photoUuid={data?.photo_uuids?.[position]}
      photoExtraExts={data?.photo_extra_exts?.[position]}
      photoBlurhash={data?.photo_blurhashes?.[position]}
      photoGeometry={album[position]?.geometry}
      album={album}
      borderRadius={12}
      style={commonStyles.secondaryEnlargeablePhoto}
      innerStyle={commonStyles.secondaryEnlargeablePhotoInner}
      isPrimary={false}
      isVerified={data?.photo_verifications?.[position] ?? false}
    />
  );

  // Compare on UUID rather than the numeric `personId` we lift out of `data`,
  // so the "Block" button doesn't briefly render before the API response lands.
  const isViewingSelf =
    !!signedInUser?.personUuid && signedInUser.personUuid === personUuid;

  const uncappedBackgroundColor = data?.theme?.background_color
      ?? appTheme.primaryColor;

  const backgroundColor = appThemeName === 'dark'
    ? capLuminance(uncappedBackgroundColor)
    : uncappedBackgroundColor;

  const lookingForCardColors = themedSurface(
    appThemeName,
    appTheme.surface,
    data?.theme?.body_color,
  );

  const basicsTheme = {
    textStyle: {
      color: data?.theme?.body_color,
    },
  };

  const clubsTheme = {
    textStyle: {
      color: data?.theme?.body_color,
    },
  };

  const mutualClubsTheme = {
    ...basicsTheme,
    style: {
      borderColor: clubsTheme.textStyle.color,
    },
  };

  const statsTheme = {
    textStyle: {
      color: data?.theme?.body_color,
    },
  };

  return (
    <>
      <View
        style={{
          paddingTop: 10,
          paddingLeft: 10,
          paddingRight: 10,
          marginBottom: 20,
        }}
      >
        <Flair flair={data?.flair ?? []} />
        {data?.show_my_looking_for === 'Yes' &&
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 14,
              paddingVertical: 14,
              paddingHorizontal: 16,
              marginTop: 20,
              marginBottom: 5,
              borderRadius: 12,
              borderWidth: 1,
              ...lookingForCardColors,
            }}
          >
            <DefaultText style={{ fontSize: 34, lineHeight: 40 }}>
              {lookingForEmoji(data)}
            </DefaultText>
            <View style={{ flex: 1 }}>
              <DefaultText
                style={{
                  color: data?.theme?.body_color,
                }}
              >
                Looking for
              </DefaultText>
              <DefaultText
                style={{
                  flexShrink: 1,
                  fontSize: 16,
                  lineHeight: 22,
                  color: data?.theme?.body_color,
                  fontWeight: 700,
                }}
              >
                {data ? lookingForDescription(data) : ''}
              </DefaultText>
            </View>
          </View>
        }

        {data?.audio_bio_uuid &&
          <AudioPlayer
            name={data?.name}
            uuid={data?.audio_bio_uuid}
            presentation="profile"
            bodyColor={data?.theme?.body_color}
          />
        }

        {hasAnyBasics(data) && <>
        <Title style={{color: data?.theme?.title_color}}>Basics</Title>
        <Basics>
          {data?.orientation &&
            <Basic {...basicsTheme} icon="person">{data.orientation}</Basic>}

          {data?.ethnicity &&
            <Basic {...basicsTheme} icon="globe-outline">{data.ethnicity}</Basic>}

          {data?.relationship_status &&
            <Basic {...basicsTheme} icon="heart">{data.relationship_status}</Basic>}

          {data?.occupation &&
            <Basic {...basicsTheme} icon="briefcase">{data.occupation}</Basic>}

          {data?.education &&
            <Basic {...basicsTheme} icon="school">{data.education}</Basic>}

          {data?.has_kids === 'Yes' &&
            <Basic {...basicsTheme} icon={faChild}>Has kids</Basic>}
          {data?.has_kids === 'No' &&
            <Basic {...basicsTheme} icon={faChild}>Doesn’t have kids</Basic>}

          {data?.wants_kids === 'Yes' &&
            <Basic {...basicsTheme} icon={faChildren}>Wants kids</Basic>}
          {data?.wants_kids === 'No' &&
            <Basic {...basicsTheme} icon={faChildren}>Doesn’t want kids</Basic>}
          {data?.wants_kids === 'Maybe' &&
            <Basic {...basicsTheme} icon={faChildren}>Maybe wants kids</Basic>}

          {data?.smoking === 'Yes' &&
            <Basic {...basicsTheme} icon={faSmoking}>Smokes</Basic>}
          {data?.smoking === 'No' &&
            <Basic {...basicsTheme} icon={faSmoking}>Doesn’t smoke</Basic>}

          {data?.drinking &&
            <Basic {...basicsTheme} icon="wine">{data.drinking} drinks</Basic>}

          {data?.drugs === 'Yes' &&
            <Basic {...basicsTheme} icon={faPills}>Does drugs</Basic>}
          {data?.drugs === 'No' &&
            <Basic {...basicsTheme} icon={faPills}>Doesn’t do drugs</Basic>}

          {data?.religion &&
            <Basic {...basicsTheme} icon={faHandsPraying}>{data.religion}</Basic>}

          {data?.star_sign &&
            <Basic {...basicsTheme} icon="star">{data.star_sign}</Basic>}

          {data?.exercise &&
            <Basic {...basicsTheme} icon="barbell">{data.exercise} exercises</Basic>}

          {data?.height_cm && signedInUser?.units === 'Metric' &&
            <Basic {...basicsTheme} icon={faRulerVertical}>{data.height_cm} cm</Basic>}
          {data?.height_cm && signedInUser?.units === 'Imperial' &&
            <Basic {...basicsTheme} icon={faRulerVertical}>{cmToFeetInchesStr(data.height_cm)}</Basic>}
        </Basics>
        </>}

        {verifiedAnything(data) && <>
          <Title style={{color: data?.theme?.title_color}}>Verification</Title>
          <DetailedVerificationBadges
            photos={(data?.photo_verifications ?? []).some(Boolean)}
            gender={data?.verified_gender ?? false}
            age={data?.verified_age ?? false}
            ethnicity={data?.verified_ethnicity ?? false}
            style={{
              marginBottom: 5,
            }}
          />
          <DefaultText
            style={{
              color: bestTextOn(backgroundColor),
              opacity: 0.5,
              marginBottom: 10,
            }}
          >
            Verification is based on selfies analyzed by our AI. Verified
            photos are most accurate.
          </DefaultText>
        </>}

        {profilePhoto(1)}

        {!data?.name &&
          <Title style={{color: data?.theme?.title_color}}>About ...</Title>
        }
        {!!data?.name && !!data?.about && data.about.trim() &&
          <>
            <Title style={{color: data?.theme?.title_color}}>About {data.name}</Title>
            <AboutText
              name={data.name}
              about={data.about}
              color={data?.theme?.body_color}
              canReply={canReply}
            />
          </>
        }

        {profilePhoto(2)}

        {profilePhoto(3)}

        <AllClubs
          mutualClubs={data?.mutual_clubs ?? []}
          otherClubs={data?.other_clubs ?? []}
          mutualClubsTheme={mutualClubsTheme}
          clubsTheme={clubsTheme}
          titleColor={data?.theme?.title_color}
        />

        {profilePhoto(4)}

        {profilePhoto(5)}

        {profilePhoto(6)}

        {hasAnyStats(data) && <>
          <Title style={{color: data?.theme?.title_color}}>Stats</Title>
          <Stats>
            {data?.seconds_since_last_online !== null &&
              <Stat {...statsTheme}>
                <DefaultText disableTheme style={{ fontWeight: '700' }}>
                  Last Online: {}
                </DefaultText>
                {
                  data === undefined ?
                  'Loading...' :
                  isOnline === 'online' ?
                  'Now' :
                  `${friendlyTimeAgo(data.seconds_since_last_online)} ago`
                }
              </Stat>
            }
            {data?.count_answers !== null &&
              <Stat {...statsTheme}>
                <DefaultText disableTheme style={{ fontWeight: '700' }}>
                  Q&A Answers: {}
                </DefaultText>
                {data?.count_answers ?? 'Loading...'}
              </Stat>
            }
            {data && !_.isNil(data.gives_reply_percentage) &&
              <Stat {...statsTheme}>
                <DefaultText disableTheme style={{ fontWeight: '700' }}>
                  Gives Replies To: {}
                </DefaultText>
                {Math.round(data.gives_reply_percentage)}% of intros
              </Stat>
            }
            {data && !_.isNil(data.gets_reply_percentage) &&
              <Stat {...statsTheme}>
                <DefaultText disableTheme style={{ fontWeight: '700' }}>
                  Gets Replies To: {}
                </DefaultText>
                {Math.round(data.gets_reply_percentage)}% of intros
              </Stat>
            }
            {data?.seconds_since_sign_up !== null &&
              <Stat {...statsTheme}>
                <DefaultText disableTheme style={{ fontWeight: '700' }}>
                  Account Age: {}
                </DefaultText>
                {
                  data === undefined ?
                  'Loading...' :
                  friendlyTimeAgo(data.seconds_since_sign_up)
                }
              </Stat>
            }
          </Stats>
        </>}

        {!!data?.count_answers && !!signedInUser &&
          <SeeQAndAButton
            navigation={navigation}
            personUuid={personUuid}
            name={data?.name}
          />}
        <ShareButton
          personUuid={data?.url_slug}
          backgroundColor={backgroundColor}
        />
        {!isViewingSelf && !!signedInUser &&
          <BlockButton
            name={data?.name}
            personUuid={personUuid}
            backgroundColor={backgroundColor}
          />}
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  wFull: {
    width: '100%',
  },
  audioPlayerMiddleText: {
    fontWeight: 700,
    flex: 3,
    ...(Platform.OS === 'web' ? {
      wordBreak: 'break-all',
    } : {}),
    textAlign: 'center',
  },
});

export {
  InDepthScreen,
  ProspectProfileScreen,
};
export type { ProspectNavigationRef };
