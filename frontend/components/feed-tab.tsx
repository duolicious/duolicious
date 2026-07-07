import {
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { DefaultText } from './default-text';
import { DuoliciousTopNavBar } from './top-nav-bar';
import { useScrollbar } from './navigation/scroll-bar-hooks';
import { Avatar } from './avatar';
import { getShortElapsedTime, isMobile, assertNever, capLuminance } from '../util/util';
import { makeLinkProps } from '../util/navigation';
import { GestureResponderEvent, Pressable, Animated, ViewStyle } from 'react-native';
import { EnlargeablePhoto } from './enlargeable-image';
import { commonStyles } from '../styles';
import { VerificationBadge } from './verification-badge';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootParamList } from '../navigation/linking';
import { japi } from '../api/api';
import { DefaultFlatList, DefaultFlashList } from './default-flat-list';
import { z } from 'zod';
import { notify, listen, lastEvent } from '../events/events';
import { consumeStaleFeed } from '../events/stale-feed';
import { Club } from './club';
import { ClubItem, joinClub, leaveClub } from '../club/club';
import { ImageBackground } from 'expo-image';
import { IMAGES_URL } from '../env/env';
import Ionicons from '@expo/vector-icons/Ionicons';
import Reanimated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { setProspectHint } from '../navigation/prospect-cache';
import { ReportModalInitialData } from './modal/report-modal';
import { Flag } from "react-native-feather";
import { AudioPlayer } from './audio-player';
import { useSkipped } from '../hide-and-block/hide-and-block';
import { TopNavBarButton } from './top-nav-bar-button';
import { setQuote } from './conversation-screen/quote';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faReply } from '@fortawesome/free-solid-svg-icons/faReply';
import { OnlineIndicator } from './online-indicator';
import { useAppTheme } from '../app-theme/app-theme';
import { usePressableAnimation } from '../animation/animation';

const NAME_ACTION_TIME_GAP_VERTICAL = 16;

const DefaultList = Platform.OS === 'web' ? DefaultFlatList : DefaultFlashList;

type Action =
  | "Added a photo"
  | "Added a voice bio"
  | "Erased their bio"
  | "Joined"
  | "Joined a club"
  | "Recently online"
  | "Updated their bio"

const DataItemBaseSchema = z.object({
  time: z.string(),
  // When the person was last online, for display
  online_time: z.string(),
  // The feed is ordered and paginated by when people's online session
  // started, while `time` is the event's time and `online_time` is when they
  // were last online, so this is the `before` cursor for the next page.
  came_online_time: z.string(),
  person_uuid: z.string(),
  url_slug: z.string().nullable(),
  name: z.string(),
  photo_uuid: z.string().nullable(),
  photo_blurhash: z.string().nullable(),
  is_verified: z.boolean(),
  match_percentage: z.number(),
  age: z.number().nullable(),
  gender: z.string(),
  location: z.string().nullable(),
});

const AddedPhotoFieldsSchema = DataItemBaseSchema.extend({
  added_photo_uuid: z.string(),
  added_photo_blurhash: z.string(),
  added_photo_extra_exts: z.array(z.string()),
});

const AddedVoiceBioFieldsSchema = DataItemBaseSchema.extend({
  added_audio_uuid: z.string(),
});

const UpdatedBioFieldsSchema = DataItemBaseSchema.extend({
  added_text: z.string(),
  background_color: z.string(),
  body_color: z.string(),
});

const JoinedFieldsSchema = DataItemBaseSchema;

const JoinedClubFieldsSchema = DataItemBaseSchema.extend({
  joined_club_name: z.string(),
  club_count_members: z.number(),
  club_sample_members: z.array(
    z.object({
      person_uuid: z.string(),
      url_slug: z.string().nullable(),
      photo_uuid: z.string(),
      photo_blurhash: z.string(),
    })
  ),
  // The viewer, as a facepile entry. Sent by the server so the facepile
  // doesn't depend on the profile-info store, which is only populated when
  // the profile tab mounts. Unlike the sample members, the viewer might not
  // have a photo.
  club_viewer: z.object({
    person_uuid: z.string(),
    url_slug: z.string().nullable(),
    photo_uuid: z.string().nullable(),
    photo_blurhash: z.string().nullable(),
  }),
  // Not sent by the server; stamped by fetchPage when the page arrives.
  // Records whether the viewer was a member (and so counted in
  // club_count_members) at fetch time, so join/leave presses can adjust the
  // count without any per-card state.
  viewer_was_member: z.boolean().optional(),
});

const DataItemJoinedSchema = JoinedFieldsSchema.extend({
  type: z.literal('joined'),
});

const DataItemJoinedClubSchema = JoinedClubFieldsSchema.extend({
  type: z.literal('joined-club'),
});

const DataItemAddedPhotoSchema = AddedPhotoFieldsSchema.extend({
  type: z.literal('added-photo'),
});

const DataItemAddedVoiceBioSchema = AddedVoiceBioFieldsSchema.extend({
  type: z.literal('added-voice-bio'),
});

const DataItemUpdatedBioSchema = UpdatedBioFieldsSchema.extend({
  type: z.literal('updated-bio'),
});

const DataItemWasRecentlyOnlineWithBioSchema = UpdatedBioFieldsSchema.extend({
  type: z.literal('recently-online-with-bio'),
});

const DataItemWasRecentlyOnlineWithPhotoSchema = AddedPhotoFieldsSchema.extend({
  type: z.literal('recently-online-with-photo'),
});

const DataItemWasRecentlyOnlineWithVoiceBioSchema = AddedVoiceBioFieldsSchema.extend({
  type: z.literal('recently-online-with-voice-bio'),
});

const DataItemSchema = z.discriminatedUnion('type', [
  DataItemJoinedSchema,
  DataItemJoinedClubSchema,
  DataItemWasRecentlyOnlineWithBioSchema,
  DataItemWasRecentlyOnlineWithPhotoSchema,
  DataItemWasRecentlyOnlineWithVoiceBioSchema,
  DataItemAddedVoiceBioSchema,
  DataItemAddedPhotoSchema,
  DataItemUpdatedBioSchema,
]);

type DataItem = z.infer<typeof DataItemSchema>;
type DataItemWasRecentlyOnlineWithBio = z.infer<typeof DataItemWasRecentlyOnlineWithBioSchema>;
type DataItemWasRecentlyOnlineWithPhoto = z.infer<typeof DataItemWasRecentlyOnlineWithPhotoSchema>;
type DataItemWasRecentlyOnlineWithVoiceBio = z.infer<typeof DataItemWasRecentlyOnlineWithVoiceBioSchema>;

type JoinedFields = z.infer<typeof JoinedFieldsSchema>;
type JoinedClubFields = z.infer<typeof JoinedClubFieldsSchema>;
type UpdatedBioFields = z.infer<typeof UpdatedBioFieldsSchema>;
type AddedPhotoFields = z.infer<typeof AddedPhotoFieldsSchema>;
type AddedVoiceBioFields = z.infer<typeof AddedVoiceBioFieldsSchema>;

const pageMetadata = {
  lastPage: null,
  seenPersonUuids: new Set<string>()
} as {
  lastPage: DataItem[] | null
  seenPersonUuids: Set<string>
};

const isValidDataItem = (item: unknown): item is DataItem => {
  const result = DataItemSchema.safeParse(item);

  if (!result.success) {
    console.warn(result.error);
  }

  return result.success;
};

const isDistinctItem = (item: DataItem) => {
  const result = !pageMetadata.seenPersonUuids.has(item.person_uuid);

  pageMetadata.seenPersonUuids.add(item.person_uuid);

  return result;
};

const stampViewerMembership = (item: DataItem): DataItem =>
  item.type === 'joined-club'
    ? { ...item, viewer_was_member: isClubMember(item.joined_club_name) }
    : item;

const fetchPage = async (pageNumber: number): Promise<DataItem[] | null> => {
  if (pageNumber === 1) {
    pageMetadata.lastPage = null;
    pageMetadata.seenPersonUuids = new Set();
  }

  const now = new Date().toISOString();

  const lastPageTime =
    pageMetadata?.lastPage?.at(-1)?.came_online_time ?? now;

  const before = pageNumber === 1 ? now : lastPageTime;

  const response = await japi(
    'get',
    `/feed-v2?before=${encodeURIComponent(before)}`,
    undefined,
    {
      maxRetries: 2,
      retryOnTransientError: true,
    }
  );

  if (!response.ok) {
    return null
  }

  if (!Array.isArray(response.json)) {
    return null;
  }

  pageMetadata.lastPage = response
    .json
    .filter(isValidDataItem)
    .filter(isDistinctItem)
    .map(stampViewerMembership);

  return [...pageMetadata.lastPage];
};

const useNavigationToProfile = (
  handle: string,
  photoBlurhash: string | null
) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootParamList>>();

  return useCallback((e: GestureResponderEvent) => {
    e.preventDefault();

    setProspectHint(handle, { photoBlurhash });
    navigation.navigate(
      'Prospect Profile Screen',
      {
        screen: 'Prospect Profile',
        params: { personUuid: handle },
      }
    );
  }, [handle, photoBlurhash]);
};

const useNavigationToProfileGallery = (photoUuid: string) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootParamList>>();

  return useCallback(() => {
    navigation.navigate(
      'Prospect Profile Screen',
      {
        screen: 'Gallery Screen',
        params: { photoUuid },
      }
    );
  }, [photoUuid]);
};

const useNavigationToConversation = (
  personUuid: string,
  name: string,
  photoUuid: string | null,
  photoBlurhash: string | null,
  quote: string,
) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootParamList>>();

  return useCallback((e: GestureResponderEvent) => {
    e.preventDefault();

    setQuote({ text: quote, attribution: name });

    setProspectHint(personUuid, { name, photoUuid, photoBlurhash });
    navigation.navigate('Conversation Screen', { personUuid });
  }, [personUuid, name, photoUuid, photoBlurhash, quote]);
};

const AgeGenderLocation = ({
  personUuid,
  urlSlug,
  photoBlurhash,
  name,
  isVerified,
  age,
  gender,
  userLocation,
  doUseOnline,
  style,
}: {
  personUuid: string
  urlSlug: string | null
  photoBlurhash: string | null
  name: string
  isVerified: boolean
  age: number | null
  gender: string
  userLocation: string | null
  doUseOnline: boolean
  style?: ViewStyle
}) => {
  const { appTheme } = useAppTheme();

  // Profile links prefer the username (url_slug), falling back to the uuid.
  const handle = urlSlug || personUuid;

  const onPressReport = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();

    const data: ReportModalInitialData = {
      name,
      personUuid,
      context: 'Feed',
    };
    notify('open-report-modal', data);
  }, [notify, name, personUuid]);

  const onPress = useNavigationToProfile(
    handle,
    photoBlurhash,
  );

  const link = makeLinkProps(`/${handle}`);

  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
      }}
    >
      <View
        style={{
          flex: 1,
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: 2,
          ...style,
        }}
      >
        <View
          style={{
            width: '100%',
            flexDirection: 'row',
            gap: 5,
            alignItems: 'center',
          }}
        >
          {doUseOnline &&
            <OnlineIndicator
              personUuid={personUuid}
              size={12}
              borderWidth={0}
            />
          }
          <Pressable
            style={{ flexShrink: 1 }}
            onPress={onPress}
            {...link}
          >
            <DefaultText
              style={{
                fontWeight: '700',
                flexShrink: 1,
              }}
            >
              {name}
            </DefaultText>
          </Pressable>
          {isVerified &&
            <VerificationBadge size={14} />
          }
        </View>
        <DefaultText style={{ color: appTheme.hintColor }}>
          {
            [
              age,
              gender,
            ]
              .filter(Boolean)
              .join(' • ')
          }
        </DefaultText>
        {userLocation &&
          <DefaultText style={{ color: appTheme.hintColor, width: '100%' }}>
            {userLocation}
          </DefaultText>
        }
      </View>
      <Flag
        hitSlop={20}
        onPress={onPressReport}
        stroke={`${appTheme.secondaryColor}80`}
        strokeWidth={2}
        height={18}
        width={18}
        style={{
          marginLeft: 10,
          cursor: 'pointer',
        }}
      />
    </View>
  );
};

const ActionTime = ({
  action,
  time,
  style,
}: {
  action: Action
  time: Date
  style?: ViewStyle
}) => {
  const { appTheme } = useAppTheme();

  return (
    <View
      style={{
        alignItems: 'center',
        width: '100%',
        flexDirection: 'row',
        ...style,
      }}
    >
      <DefaultText
        style={{
          color: appTheme.secondaryColor,
          fontWeight: '700',
          fontSize: 18,
        }}
      >
        {action}
      </DefaultText>
      <DefaultText
        style={{
          color: appTheme.hintColor,
        }}
      >
        {' '}• {getShortElapsedTime(time)}
      </DefaultText>
    </View>
  );
};

const FeedItemJoined = ({ fields }: { fields: JoinedFields }) => {
  const { appTheme } = useAppTheme();

  const onPress = useNavigationToProfile(
    fields.person_uuid,
    fields.photo_blurhash,
  );

  const { backgroundColor, onPressIn, onPressOut } = usePressableAnimation();

  const props = isMobile() ? {
    onPress,
    onPressIn,
    onPressOut,
  } : {
    disabled: true,
  };

  return (
    <Pressable style={styles.pressableStyle} {...props}>
      <Animated.View style={[styles.cardBorders, appTheme.card, { backgroundColor }]}>
        {fields.photo_uuid &&
          <Avatar
            percentage={fields.match_percentage}
            personUuid={fields.person_uuid}
            urlSlug={fields.url_slug}
            photoUuid={fields.photo_uuid}
            photoBlurhash={fields.photo_blurhash}
            doUseOnline={!!fields.photo_uuid}
          />
        }
        <View style={{ flex: 1, gap: NAME_ACTION_TIME_GAP_VERTICAL }}>
          <AgeGenderLocation
            personUuid={fields.person_uuid}
            urlSlug={fields.url_slug}
            photoBlurhash={fields.photo_blurhash}
            name={fields.name}
            isVerified={fields.is_verified}
            age={fields.age}
            gender={fields.gender}
            userLocation={fields.location}
            doUseOnline={!fields.photo_uuid}
          />
          <ActionTime action="Joined" time={new Date(fields.time)} />
        </View>
      </Animated.View>
    </Pressable>
  );
};

const isClubMember = (clubName: string) =>
  (lastEvent<ClubItem[]>('updated-clubs') ?? [])
    .some((c) => c.name === clubName);

const useIsClubMember = (clubName: string) => {
  const subscribe = useCallback(
    (onChange: () => void) => listen('updated-clubs', onChange),
    [],
  );

  return useSyncExternalStore(subscribe, () => isClubMember(clubName));
};

// While the pile is collapsed the avatars overlap; spreading separates them
// so each face can be seen and pressed. The margin is animated directly with
// an explicit easing curve rather than via a layout transition, whose easing
// isn't respected on web.
const useFacepileSpreadStyle = (overlap: boolean, spread: boolean) => {
  const progress = useSharedValue(spread ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(spread ? 1 : 0, {
      duration: 250,
      easing: Easing.out(Easing.poly(4)),
    });
  }, [spread, progress]);

  return useAnimatedStyle(() => ({
    marginLeft: overlap ? interpolate(progress.value, [0, 1], [-8, 4]) : 0,
  }), [overlap]);
};

const FacepileAvatar = ({
  member,
  overlap,
  spread,
  onRequestSpread,
}: {
  member: JoinedClubFields['club_sample_members'][number]
  overlap: boolean
  spread: boolean
  onRequestSpread: () => void
}) => {
  const handle = member.url_slug || member.person_uuid;

  const navigateToProfile = useNavigationToProfile(
    handle,
    member.photo_blurhash,
  );

  const onPress = useCallback((e: GestureResponderEvent) => {
    if (spread) {
      navigateToProfile(e);
    } else {
      // Stop the web link navigating; the first press only spreads the pile
      e.preventDefault();
      onRequestSpread();
    }
  }, [spread, navigateToProfile, onRequestSpread]);

  const spreadStyle = useFacepileSpreadStyle(overlap, spread);

  return (
    <Reanimated.View style={spreadStyle}>
      <Pressable onPress={onPress} {...makeLinkProps(`/${handle}`)}>
        <ImageBackground
          source={{
            uri: `${IMAGES_URL}/450-${member.photo_uuid}.jpg`,
            height: 450,
            width: 450,
          }}
          placeholder={{ blurhash: member.photo_blurhash }}
          transition={150}
          style={styles.facepileImage}
          contentFit="cover"
          recyclingKey={member.photo_uuid}
        />
      </Pressable>
    </Reanimated.View>
  );
};

// The viewer's own avatar, at the end of the facepile. Always rendered, but
// only visible while the viewer is a member of the club, fading in and out as
// they join and leave. Animating visibility on an always-mounted view rather
// than mounting and unmounting means joining can't be confused with anything
// else that recreates the view (navigating away and back, list recycling,
// refetches), which is what made `entering` animations here replay when they
// shouldn't. Falls back to a placeholder if the viewer has no photo.
const ViewerFacepileAvatar = ({
  viewer,
  visible,
  overlap,
  spread,
  onRequestSpread,
}: {
  viewer: JoinedClubFields['club_viewer']
  visible: boolean
  overlap: boolean
  spread: boolean
  onRequestSpread: () => void
}) => {
  const { appTheme } = useAppTheme();

  const handle = viewer.url_slug || viewer.person_uuid;

  const navigateToProfile = useNavigationToProfile(
    handle,
    viewer.photo_blurhash,
  );

  const onPress = useCallback((e: GestureResponderEvent) => {
    if (spread) {
      navigateToProfile(e);
    } else {
      e.preventDefault();
      onRequestSpread();
    }
  }, [spread, navigateToProfile, onRequestSpread]);

  const spreadStyle = useFacepileSpreadStyle(overlap, spread);

  const opacity = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    opacity.value = withTiming(visible ? 1 : 0, {
      duration: 250,
      easing: Easing.out(Easing.poly(4)),
    });
  }, [visible, opacity]);

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Reanimated.View
      style={[
        styles.facepileImage,
        spreadStyle,
        fadeStyle,
        {
          backgroundColor: appTheme.avatarBackgroundColor,
          // An invisible avatar shouldn't be pressable or follow its link.
          // Toggled instantly so a fading-out avatar isn't pressable either.
          pointerEvents: visible ? 'auto' : 'none',
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        style={styles.viewerFacepilePressable}
        {...makeLinkProps(`/${handle}`)}
      >
        {viewer.photo_uuid
          ? <ImageBackground
              source={{
                uri: `${IMAGES_URL}/450-${viewer.photo_uuid}.jpg`,
                height: 450,
                width: 450,
              }}
              placeholder={
                viewer.photo_blurhash && { blurhash: viewer.photo_blurhash }}
              transition={150}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey={viewer.photo_uuid}
            />
          : <Ionicons
              style={{ fontSize: 16, color: appTheme.avatarColor }}
              name="person"
            />
        }
      </Pressable>
    </Reanimated.View>
  );
};

const ClubFacepile = ({
  sampleMembers,
  countMembers,
  viewer,
  viewerIsMember,
}: {
  sampleMembers: JoinedClubFields['club_sample_members']
  countMembers: number
  viewer: JoinedClubFields['club_viewer']
  viewerIsMember: boolean
}) => {
  const { appTheme } = useAppTheme();

  // Overlapped avatars are hard to make out and to press, so the pile spreads
  // on hover (desktop) or on a first press (mobile) before individual avatars
  // navigate anywhere
  const [spread, setSpread] = useState(false);

  const onRequestSpread = useCallback(() => setSpread(true), []);

  return (
    // On mobile the count goes on its own line: were it beside the pile,
    // spreading the pile could wrap the text and change the card's height
    <View style={styles.facepileColumn}>
      {(sampleMembers.length > 0 || viewerIsMember) &&
        <Pressable
          style={{ flexDirection: 'row' }}
          onPress={onRequestSpread}
          // Raw DOM events rather than onHoverIn/onHoverOut: Pressable's
          // hover uses contain semantics, so hovering the nested avatar
          // Pressables would end the container's hover and re-collapse the
          // pile. mouseenter/mouseleave don't refire on child transitions.
          //
          // Desktop-only: mobile web browsers emulate mouseenter on tap,
          // which would spread the pile an instant before the press lands
          // and turn the first press into a profile navigation.
          {...(isMobile() ? {} : {
            /* @ts-ignore */
            onMouseEnter: onRequestSpread,
            onMouseLeave: () => setSpread(false),
          })}
        >
          {sampleMembers.map((member, i) =>
            <FacepileAvatar
              key={member.person_uuid}
              member={member}
              overlap={i > 0}
              spread={spread}
              onRequestSpread={onRequestSpread}
            />
          )}
          <ViewerFacepileAvatar
            viewer={viewer}
            visible={viewerIsMember}
            overlap={sampleMembers.length > 0}
            spread={spread}
            onRequestSpread={onRequestSpread}
          />
        </Pressable>
      }
      <DefaultText style={{ color: appTheme.hintColor }}>
        {countMembers.toLocaleString()}
        {countMembers === 1 ? ' member' : ' members'}
      </DefaultText>
    </View>
  );
};

const FeedItemJoinedClub = ({ fields }: { fields: JoinedClubFields }) => {
  const { appTheme } = useAppTheme();

  const onPress = useNavigationToProfile(
    fields.person_uuid,
    fields.photo_blurhash,
  );

  const { backgroundColor, onPressIn, onPressOut } = usePressableAnimation();

  const isMember = useIsClubMember(fields.joined_club_name);

  // Optimistic: joinClub/leaveClub update the 'updated-clubs' event before
  // their network requests are sent, so the count and facepile change
  // immediately. The server counted the viewer iff they were a member at
  // fetch time (viewer_was_member) and never puts them among the sample
  // members; the viewer's avatar (club_viewer) is only visible while they're
  // a member.
  const viewerWasMember = fields.viewer_was_member ?? false;
  const countMembers = fields.club_count_members
    + (isMember ? 1 : 0)
    - (viewerWasMember ? 1 : 0);

  // Returning `false` makes the chip shake and show the point of sale, the
  // same way the profile screen's club chips do when the quota's been hit
  const onPressClub = useCallback(() => {
    if (isMember) {
      leaveClub(fields.joined_club_name);
    } else {
      return joinClub(fields.joined_club_name, fields.club_count_members, false);
    }
  }, [isMember, fields.joined_club_name, fields.club_count_members]);

  const props = isMobile() ? {
    onPress,
    onPressIn,
    onPressOut,
  } : {
    disabled: true,
  };

  return (
    <Pressable style={styles.pressableStyle} {...props}>
      <Animated.View style={[styles.cardBorders, appTheme.card, { backgroundColor }]}>
        {fields.photo_uuid &&
          <Avatar
            percentage={fields.match_percentage}
            personUuid={fields.person_uuid}
            urlSlug={fields.url_slug}
            photoUuid={fields.photo_uuid}
            photoBlurhash={fields.photo_blurhash}
            doUseOnline={!!fields.photo_uuid}
          />
        }
        <View style={{ flex: 1, gap: NAME_ACTION_TIME_GAP_VERTICAL }}>
          <AgeGenderLocation
            personUuid={fields.person_uuid}
            urlSlug={fields.url_slug}
            photoBlurhash={fields.photo_blurhash}
            name={fields.name}
            isVerified={fields.is_verified}
            age={fields.age}
            gender={fields.gender}
            userLocation={fields.location}
            doUseOnline={!fields.photo_uuid}
          />
          <ActionTime action="Joined a club" time={new Date(fields.time)} />
          <View style={{ flexDirection: 'row' }}>
            <Club
              name={fields.joined_club_name}
              isMutual={isMember}
              onPress={onPressClub}
              // Like the prospect profile's mutual clubs, whose border takes
              // the chip's text color
              style={
                isMember ? { borderColor: appTheme.secondaryColor } : undefined}
            />
          </View>
          <ClubFacepile
            // Keying by the card's identity resets the spread state when the
            // native list recycles this component instance for another item
            key={`${fields.person_uuid}:${fields.joined_club_name}`}
            sampleMembers={fields.club_sample_members}
            countMembers={countMembers}
            viewer={fields.club_viewer}
            viewerIsMember={isMember}
          />
        </View>
      </Animated.View>
    </Pressable>
  );
};

const FeedItemWasRecentlyOnline = ({
  dataItem
}: {
  dataItem:
    | DataItemWasRecentlyOnlineWithBio
    | DataItemWasRecentlyOnlineWithPhoto
    | DataItemWasRecentlyOnlineWithVoiceBio
}) => {
  switch (dataItem.type) {
    case 'recently-online-with-bio':
      return <FeedItemUpdatedBio fields={dataItem} action="Recently online" />;
    case 'recently-online-with-photo':
      return <FeedItemAddedPhoto fields={dataItem} action="Recently online" />;
    case 'recently-online-with-voice-bio':
      return <FeedItemAddedVoiceBio fields={dataItem} action="Recently online" />;
    default:
      return assertNever(dataItem);
  }
};

const FeedItemAddedPhoto = ({
  fields,
  action = "Added a photo",
}: {
  fields: AddedPhotoFields,
  action?: Action,
}) => {
  const { appTheme } = useAppTheme();

  const onPress = useNavigationToProfile(
    fields.person_uuid,
    fields.photo_blurhash,
  );

  const onPressPhoto = useNavigationToProfileGallery(fields.added_photo_uuid);

  const { backgroundColor, onPressIn, onPressOut } = usePressableAnimation();

  const props = isMobile() ? {
    onPress,
    onPressIn,
    onPressOut,
  } : {
    disabled: true,
  };

  return (
    <Pressable style={styles.pressableStyle} {...props}>
      <Animated.View style={[styles.cardBorders, appTheme.card, { backgroundColor }]}>
        {fields.photo_uuid &&
          <Avatar
            percentage={fields.match_percentage}
            personUuid={fields.person_uuid}
            urlSlug={fields.url_slug}
            photoUuid={fields.photo_uuid}
            photoBlurhash={fields.photo_blurhash}
            doUseOnline={!!fields.photo_uuid}
          />
        }
        <View style={{ flex: 1, gap: NAME_ACTION_TIME_GAP_VERTICAL }}>
          <AgeGenderLocation
            personUuid={fields.person_uuid}
            urlSlug={fields.url_slug}
            photoBlurhash={fields.photo_blurhash}
            name={fields.name}
            isVerified={fields.is_verified}
            age={fields.age}
            gender={fields.gender}
            userLocation={fields.location}
            doUseOnline={!fields.photo_uuid}
          />
          <ActionTime action={action} time={new Date(fields.time)} />
          <EnlargeablePhoto
            onPress={onPressPhoto}
            photoUuid={fields.added_photo_uuid}
            photoExtraExts={fields.added_photo_extra_exts}
            photoBlurhash={fields.added_photo_blurhash}
            isPrimary={true}
            style={{
              ...commonStyles.secondaryEnlargeablePhoto,
              marginTop: 0,
              marginBottom: 0,
            }}
          />
        </View>
      </Animated.View>
    </Pressable>
  );
};

const FeedItemAddedVoiceBio = ({
  fields,
  action = "Added a voice bio"
}: {
  fields: AddedVoiceBioFields
  action?: Action
}) => {
  const { appTheme } = useAppTheme();

  const onPress = useNavigationToProfile(
    fields.person_uuid,
    fields.photo_blurhash,
  );

  const { backgroundColor, onPressIn, onPressOut } = usePressableAnimation();

  const props = isMobile() ? {
    onPress,
    onPressIn,
    onPressOut,
  } : {
    disabled: true,
  };

  return (
    <Pressable style={styles.pressableStyle} {...props}>
      <Animated.View style={[styles.cardBorders, appTheme.card, { backgroundColor }]}>
        {fields.photo_uuid &&
          <Avatar
            percentage={fields.match_percentage}
            personUuid={fields.person_uuid}
            urlSlug={fields.url_slug}
            photoUuid={fields.photo_uuid}
            photoBlurhash={fields.photo_blurhash}
            doUseOnline={!!fields.photo_uuid}
          />
        }
        <View style={{ flex: 1, gap: NAME_ACTION_TIME_GAP_VERTICAL }}>
          <AgeGenderLocation
            personUuid={fields.person_uuid}
            urlSlug={fields.url_slug}
            photoBlurhash={fields.photo_blurhash}
            name={fields.name}
            isVerified={fields.is_verified}
            age={fields.age}
            gender={fields.gender}
            userLocation={fields.location}
            doUseOnline={!fields.photo_uuid}
          />
          <ActionTime action={action} time={new Date(fields.time)} />
          <AudioPlayer
            uuid={fields.added_audio_uuid}
            presentation="feed"
            style={{ marginTop: 0 }}
          />
        </View>
      </Animated.View>
    </Pressable>
  );
};

const FeedItemUpdatedBio = ({
  fields,
  action = "Updated their bio"
}: {
  fields: UpdatedBioFields,
  action?: Action,
}) => {
  const { appThemeName, appTheme } = useAppTheme();

  const onPress = useNavigationToProfile(
    fields.person_uuid,
    fields.photo_blurhash,
  );

  const onPressReply = useNavigationToConversation(
    fields.person_uuid,
    fields.name,
    fields.photo_uuid,
    fields.photo_blurhash,
    fields.added_text,
  );

  const { backgroundColor, onPressIn, onPressOut } = usePressableAnimation();

  const props = isMobile() ? {
    onPress,
    onPressIn,
    onPressOut,
  } : {
    disabled: true,
  };

  return (
    <Pressable style={styles.pressableStyle} {...props}>
      <Animated.View style={[styles.cardBorders, appTheme.card, { backgroundColor }]}>
        {fields.photo_uuid &&
          <Avatar
            percentage={fields.match_percentage}
            personUuid={fields.person_uuid}
            urlSlug={fields.url_slug}
            photoUuid={fields.photo_uuid}
            photoBlurhash={fields.photo_blurhash}
            doUseOnline={!!fields.photo_uuid}
          />
        }
        <View style={{ flex: 1, gap: isMobile() ? 8 : 10 }}>
          <View style={{ flex: 1, gap: NAME_ACTION_TIME_GAP_VERTICAL }}>
            <AgeGenderLocation
              personUuid={fields.person_uuid}
              urlSlug={fields.url_slug}
              photoBlurhash={fields.photo_blurhash}
              name={fields.name}
              isVerified={fields.is_verified}
              age={fields.age}
              gender={fields.gender}
              userLocation={fields.location}
              doUseOnline={!fields.photo_uuid}
              style={{
                paddingHorizontal: 10,
              }}
            />
            <ActionTime
              action={action}
              time={new Date(fields.time)}
              style={{ paddingHorizontal: 10 }}
            />
            <DefaultText
              style={{
                backgroundColor:
                  appThemeName === 'dark'
                    ? capLuminance(fields.background_color)
                    : fields.background_color,
                color: fields.body_color,
                borderRadius: 10,
                padding: 10,
              }}
            >
              {fields.added_text}
            </DefaultText>
          </View>
          <View style={{ alignItems: 'flex-end' }} >
            <Pressable
              style={{
                flexDirection: 'row',
                gap: 6,
                paddingRight: 5,
              }}
              hitSlop={20}
              onPress={onPressReply}
            >
              <DefaultText style={{ fontWeight: 700 }}>
                Reply
              </DefaultText>
              <FontAwesomeIcon
                icon={faReply}
                size={16}
                color={appTheme.secondaryColor}
                style={{
                  /* @ts-ignore */
                  outline: 'none',
                }}
              />
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
};

const FeedItem = ({ dataItem }: { dataItem: DataItem }) => {
  const { isSkipped } = useSkipped(dataItem.person_uuid);

  if (isSkipped) {
    return <></>;
  }

  switch (dataItem.type) {
    case 'joined':
      return <FeedItemJoined fields={dataItem} />;
    case 'joined-club':
      return <FeedItemJoinedClub fields={dataItem} />;
    case 'recently-online-with-bio':
    case 'recently-online-with-photo':
    case 'recently-online-with-voice-bio':
      return <FeedItemWasRecentlyOnline dataItem={dataItem} />;
    case 'added-photo':
      return <FeedItemAddedPhoto fields={dataItem} />;
    case 'added-voice-bio':
      return <FeedItemAddedVoiceBio fields={dataItem} />;
    case 'updated-bio':
      return <FeedItemUpdatedBio fields={dataItem} />;
    default:
      return assertNever(dataItem);
  }
};

const FeedTab = () => {
  const {
    onLayout,
    onContentSizeChange,
    onScroll,
    showsVerticalScrollIndicator,
    observeListRef,
  } = useScrollbar('traits');

  const listRef = useRef<{ refresh: () => void } | null>(null);

  const onPressRefresh = useCallback(() => {
    const refresh = listRef?.current?.refresh;
    refresh && refresh();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (consumeStaleFeed()) {
        onPressRefresh();
      }
    }, [onPressRefresh])
  );

  return (
    <View style={styles.safeAreaView}>
      <DuoliciousTopNavBar>
        {Platform.OS === 'web' &&
          <TopNavBarButton
            onPress={onPressRefresh}
            iconName="refresh"
            position="left"
            secondary={true}
            label="Refresh"
          />
        }
      </DuoliciousTopNavBar>
      <DefaultList
        ref={listRef}
        innerRef={observeListRef}
        emptyText={
          "Your feed is empty right now. Check back later to see what " +
          "everyone’s doing\xa0👀"
        }
        errorText={"Something went wrong while fetching your feed\xa0😵‍💫"}
        endText={
          "You’re all caught up! Check back later to see what " +
          "everyone’s doing\xa0👀"
        }
        fetchPage={fetchPage}
        contentContainerStyle={styles.listContentContainerStyle}
        renderItem={({ item }: { item: DataItem }) =>
          <FeedItem dataItem={item} />
        }
        keyExtractor={(item: DataItem) => item.person_uuid}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        onScroll={onScroll}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  listContentContainerStyle: {
    paddingTop: 10,
    paddingLeft: 10,
    paddingRight: 10,
    paddingBottom: 20,
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
  },
  safeAreaView: {
    flex: 1
  },
  cardBorders: {
    ...commonStyles.cardBorders,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  pressableStyle: {
    marginBottom: 20,
  },
  facepileColumn: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
  },
  facepileImage: {
    height: 28,
    width: 28,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerFacepilePressable: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export {
  FeedTab,
};
