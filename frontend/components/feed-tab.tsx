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
} from 'react';
import { DefaultText } from './default-text';
import { DuoliciousTopNavBar } from './top-nav-bar';
import { useScrollbar } from './navigation/scroll-bar-hooks';
import { Avatar } from './avatar';
import { getShortElapsedTime, isMobile, assertNever, capLuminance, formatCount } from '../util/util';
import { makeLinkProps } from '../util/navigation';
import { GestureResponderEvent, LayoutChangeEvent, Pressable, Animated, ViewStyle } from 'react-native';
import { EnlargeablePhoto } from './enlargeable-image';
import { commonStyles } from '../styles';
import { VerificationBadge } from './verification-badge';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootParamList } from '../navigation/linking';
import { japi } from '../api/api';
import {
  ViewerAnswer,
  seedViewerAnswer,
  setAnswerPublicly,
  toggleAnswer,
  useViewerAnswer,
} from '../api/answer';
import { DefaultFlatList, DefaultFlashList } from './default-flat-list';
import { z } from 'zod';
import { notify, lastEvent, useDerivedEvent } from '../events/events';
import { consumeStaleFeed } from '../events/stale-feed';
import { Club } from './club';
import { ClubItem, joinClub, leaveClub } from '../club/club';
import { ImageBackground } from 'expo-image';
import { IMAGES_URL } from '../env/env';
import Ionicons from '@expo/vector-icons/Ionicons';
import Reanimated, {
  Easing,
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
import { quizCardQuoteText } from './conversation-screen/quote';
import { useNavigationToConversation } from '../navigation/use-navigation-to-conversation';
import { ReplyButton } from './reply-button';
import { OnlineIndicator } from './online-indicator';
import { useAppTheme } from '../app-theme/app-theme';
import { usePressableAnimation } from '../animation/animation';
import {
  ANSWER_ICON_SIZE,
  AnswerIcon,
  NonInteractiveQuizCard,
} from './quiz-card';

const NAME_ACTION_TIME_GAP_VERTICAL = 16;

const DefaultList = Platform.OS === 'web' ? DefaultFlatList : DefaultFlashList;

type Action =
  | "Added a photo"
  | "Added a voice bio"
  | "Erased their bio"
  | "Joined"
  | "Joined a club"
  | "Played Q&A"
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

// Absent for photos whose geometry the server hasn't recorded, which the
// gallery reads as "don't expand this one".
const PhotoGeometrySchema = z.object({
  width: z.number(),
  height: z.number(),
  crop_top: z.number(),
  crop_left: z.number(),
});

const AddedPhotoFieldsSchema = DataItemBaseSchema.extend({
  added_photo_uuid: z.string(),
  added_photo_blurhash: z.string(),
  added_photo_extra_exts: z.array(z.string()),
  added_photo_geometry: PhotoGeometrySchema.optional(),
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

const FacepileMemberSchema = z.object({
  person_uuid: z.string(),
  url_slug: z.string().nullable(),
  photo_uuid: z.string(),
  photo_blurhash: z.string(),
});

// The viewer, as a facepile entry. Sent by the server so the facepile
// doesn't depend on the profile-info store, which is only populated when
// the profile tab mounts. Unlike the sample members, the viewer might not
// have a photo.
const FacepileViewerSchema = z.object({
  person_uuid: z.string(),
  url_slug: z.string().nullable(),
  photo_uuid: z.string().nullable(),
  photo_blurhash: z.string().nullable(),
});

const JoinedClubFieldsSchema = DataItemBaseSchema.extend({
  joined_club_name: z.string(),
  club_count_members: z.number(),
  club_sample_members: z.array(FacepileMemberSchema),
  club_viewer: FacepileViewerSchema,
  // Not sent by the server; stamped by fetchPage when the page arrives.
  // Records whether the viewer was a member (and so counted in
  // club_count_members) at fetch time, so join/leave presses can adjust the
  // count without any per-card state.
  viewer_was_member: z.boolean().optional(),
});

const AnsweredQuestionFieldsSchema = DataItemBaseSchema.extend({
  answered_question_id: z.number(),
  question_text: z.string(),
  question_topic: z.string(),
  // Like the quiz screen's counts, these include private answers
  question_count_yes: z.number(),
  question_count_no: z.number(),
  question_yes_members: z.array(FacepileMemberSchema),
  question_no_members: z.array(FacepileMemberSchema),
  // The feed subject's answer while it's publicly visible, so replying can
  // quote it
  question_subject_answer: z.boolean().nullable(),
  // The viewer's own answer, private or not; `public_` is null when they
  // haven't answered
  question_viewer: FacepileViewerSchema.extend({
    answer: z.boolean().nullable(),
    public_: z.boolean().nullable(),
  }),
});

const DataItemJoinedSchema = JoinedFieldsSchema.extend({
  type: z.literal('joined'),
});

const DataItemJoinedClubSchema = JoinedClubFieldsSchema.extend({
  type: z.literal('joined-club'),
});

const DataItemAnsweredQuestionSchema = AnsweredQuestionFieldsSchema.extend({
  type: z.literal('answered-question'),
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
  DataItemAnsweredQuestionSchema,
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
type AnsweredQuestionFields = z.infer<typeof AnsweredQuestionFieldsSchema>;
type FacepileMember = z.infer<typeof FacepileMemberSchema>;
type FacepileViewer = z.infer<typeof FacepileViewerSchema>;
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

const seedViewerAnswerFromItem = (item: DataItem): void => {
  if (item.type === 'answered-question') {
    seedViewerAnswer(item.answered_question_id, {
      answer: item.question_viewer.answer,
      public_: item.question_viewer.public_ ?? true,
    });
  }
};

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

  pageMetadata.lastPage.forEach(seedViewerAnswerFromItem);

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

const useIsClubMember = (clubName: string) =>
  useDerivedEvent(
    'updated-clubs',
    (clubs: ClubItem[] | undefined) =>
      (clubs ?? []).some((c) => c.name === clubName),
    [clubName],
  );

// Facepile geometry. Named because the width math in QuestionFacepiles
// depends on these, so it can't silently disagree with the styles.
const FACEPILE_AVATAR_SIZE = 28;

// How far each avatar tucks behind its left neighbour while a pile is
// collapsed
const FACEPILE_OVERLAP = 8;

// The gap left between neighbouring avatars once a pile spreads
const FACEPILE_SPREAD_GAP = 4;

// How far spreading moves each avatar relative to its neighbour
const FACEPILE_SPREAD_STEP = FACEPILE_OVERLAP + FACEPILE_SPREAD_GAP;

// The gap between an answer icon and its pile in a question facepile row
const FACEPILE_GROUP_GAP = 8;

// A question facepile row's horizontal padding, per side
const FACEPILE_ROW_PADDING = 12;

// A pile's laid-out width. `slotCount` counts every avatar, including the
// always-rendered viewer slot. Collapsed, each slot past the first shows only
// an un-overlapped sliver; spreading adds a step per slot. The pile is given
// this width explicitly so that, while spread, its container grows to contain
// the translated avatars: on Android a child rendered outside its parent's
// bounds stops receiving touches, which left the outermost avatar unpressable.
const facepileCollapsedWidth = (slotCount: number) =>
  FACEPILE_AVATAR_SIZE
  + (slotCount - 1) * (FACEPILE_AVATAR_SIZE - FACEPILE_OVERLAP);

const facepileSpreadWidth = (slotCount: number) =>
  facepileCollapsedWidth(slotCount)
  + (slotCount - 1) * FACEPILE_SPREAD_STEP;

const FacepileAvatar = ({
  member,
  navigatesOnPress,
  onRequestSpread,
}: {
  member: FacepileMember
  navigatesOnPress: boolean
  onRequestSpread: () => void
}) => {
  const handle = member.url_slug || member.person_uuid;

  const { appTheme } = useAppTheme();

  const navigateToProfile = useNavigationToProfile(
    handle,
    member.photo_blurhash,
  );

  const onPress = useCallback((e: GestureResponderEvent) => {
    if (navigatesOnPress) {
      navigateToProfile(e);
    } else {
      // Stop the web link navigating; the first press only spreads the pile
      e.preventDefault();
      onRequestSpread();
    }
  }, [navigatesOnPress, navigateToProfile, onRequestSpread]);

  return (
    <Pressable onPress={onPress} {...makeLinkProps(`/${handle}`)}>
      <ImageBackground
        source={{
          uri: `${IMAGES_URL}/450-${member.photo_uuid}.jpg`,
          height: 450,
          width: 450,
        }}
        placeholder={{ blurhash: member.photo_blurhash }}
        transition={150}
        style={[styles.facepileImage, { borderColor: appTheme.primaryColor }]}
        contentFit="cover"
        recyclingKey={member.photo_uuid}
      />
    </Pressable>
  );
};

// The viewer's own avatar. Always rendered, but only visible while the
// viewer belongs in the pile (they're a club member; they publicly gave the
// pile's answer), fading in and out as that changes. Animating visibility on
// an always-mounted view rather than mounting and unmounting means joining
// can't be confused with anything else that recreates the view (navigating
// away and back, list recycling, refetches), which is what made `entering`
// animations here replay when they shouldn't. Falls back to a placeholder if
// the viewer has no photo.
const ViewerFacepileAvatar = ({
  viewer,
  visible,
  navigatesOnPress,
  onRequestSpread,
}: {
  viewer: FacepileViewer
  visible: boolean
  navigatesOnPress: boolean
  onRequestSpread: () => void
}) => {
  const { appTheme } = useAppTheme();

  const handle = viewer.url_slug || viewer.person_uuid;

  const navigateToProfile = useNavigationToProfile(
    handle,
    viewer.photo_blurhash,
  );

  const onPress = useCallback((e: GestureResponderEvent) => {
    if (navigatesOnPress) {
      navigateToProfile(e);
    } else {
      e.preventDefault();
      onRequestSpread();
    }
  }, [navigatesOnPress, navigateToProfile, onRequestSpread]);

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
        fadeStyle,
        {
          backgroundColor: appTheme.avatarBackgroundColor,
          borderColor: appTheme.primaryColor,
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

// A facepile avatar's animated position. Translated rather than
// margin-animated so that spreading a pile can't reflow the layout around it
const FacepileSlot = ({
  overlap,
  offsetX,
  zIndex,
  children,
}: {
  overlap: boolean
  offsetX: number
  zIndex?: number
  children: React.ReactNode
}) => {
  const offset = useSharedValue(offsetX);

  useEffect(() => {
    offset.value = withTiming(offsetX, {
      duration: 250,
      easing: Easing.out(Easing.poly(4)),
    });
  }, [offsetX, offset]);

  const offsetStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return (
    <Reanimated.View
      style={[
        offsetStyle,
        { marginLeft: overlap ? -FACEPILE_OVERLAP : 0, zIndex },
      ]}
    >
      {children}
    </Reanimated.View>
  );
};

// While the pile is collapsed the avatars overlap, which makes them hard to
// make out and to press, so the pile spreads on hover (desktop) or on a first
// press (mobile) before individual avatars navigate anywhere. The avatar
// beside `viewerPosition` is the anchor: the pile spreads away from it, so a
// pile can sit against that edge of its container.
const Facepile = ({
  members,
  viewer,
  viewerVisible,
  viewerPosition,
  spread,
  onRequestSpread,
  onRequestCollapse,
}: {
  members: FacepileMember[]
  viewer: FacepileViewer
  viewerVisible: boolean
  viewerPosition: 'start' | 'end'
  spread: boolean
  onRequestSpread: () => void
  onRequestCollapse: () => void
}) => {
  const spreadDirection = viewerPosition === 'start' ? -1 : 1;

  // The viewer slot is always rendered, so it always occupies layout width
  const slotCount = members.length + 1;

  const isSpreadable = members.length + (viewerVisible ? 1 : 0) > 1;

  const isSpread = spread && isSpreadable;

  const navigatesOnPress = isSpread || !isSpreadable;

  const anchorDistanceOf = (documentOrder: number) =>
    viewerPosition === 'start'
      ? members.length - documentOrder
      : documentOrder;

  const offsetOf = (documentOrder: number) =>
    spreadDirection
      * anchorDistanceOf(documentOrder)
      * (isSpread ? FACEPILE_SPREAD_STEP : 0);

  const zIndexOf = (documentOrder: number) =>
    viewerPosition === 'start'
      ? members.length + 1 - documentOrder
      : undefined;

  const viewerAvatar = (documentOrder: number) => (
    <FacepileSlot
      overlap={documentOrder > 0}
      offsetX={offsetOf(documentOrder)}
      zIndex={zIndexOf(documentOrder)}
    >
      <ViewerFacepileAvatar
        viewer={viewer}
        visible={viewerVisible}
        navigatesOnPress={navigatesOnPress}
        onRequestSpread={onRequestSpread}
      />
    </FacepileSlot>
  );

  return (
    <Pressable
      style={{
        flexDirection: 'row',
        // Spread grows away from the anchor; keep the anchored edge fixed so
        // the collapsed cluster stays put and only the reserved side widens
        justifyContent: viewerPosition === 'start' ? 'flex-end' : 'flex-start',
        width: isSpread
          ? facepileSpreadWidth(slotCount)
          : facepileCollapsedWidth(slotCount),
        cursor: 'auto',
      }}
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
        onMouseLeave: onRequestCollapse,
      })}
    >
      {viewerPosition === 'start' && viewerAvatar(0)}
      {members.map((member, i) => {
        const documentOrder = viewerPosition === 'start' ? i + 1 : i;

        return (
          <FacepileSlot
            key={member.person_uuid}
            overlap={documentOrder > 0}
            offsetX={offsetOf(documentOrder)}
            zIndex={zIndexOf(documentOrder)}
          >
            <FacepileAvatar
              member={member}
              navigatesOnPress={navigatesOnPress}
              onRequestSpread={onRequestSpread}
            />
          </FacepileSlot>
        );
      })}
      {viewerPosition === 'end' && viewerAvatar(members.length)}
    </Pressable>
  );
};

const ClubFacepile = ({
  sampleMembers,
  countMembers,
  viewer,
  viewerIsMember,
}: {
  sampleMembers: FacepileMember[]
  countMembers: number
  viewer: FacepileViewer
  viewerIsMember: boolean
}) => {
  const { appTheme } = useAppTheme();

  const [spread, setSpread] = useState(false);

  const onRequestSpread   = useCallback(() => setSpread(true),  []);
  const onRequestCollapse = useCallback(() => setSpread(false), []);

  return (
    // On mobile the count goes on its own line: were it beside the pile,
    // a spread pile would slide over the text
    <View style={styles.facepileColumn}>
      {(sampleMembers.length > 0 || viewerIsMember) &&
        <Facepile
          members={sampleMembers}
          viewer={viewer}
          viewerVisible={viewerIsMember}
          viewerPosition="end"
          spread={spread}
          onRequestSpread={onRequestSpread}
          onRequestCollapse={onRequestCollapse}
        />
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

const QuestionFacepiles = ({
  fields,
  viewerAnswer,
  onPressNo,
  onPressYes,
}: {
  fields: AnsweredQuestionFields
  viewerAnswer: ViewerAnswer
  onPressNo: () => void
  onPressYes: () => void
}) => {
  const { appTheme } = useAppTheme();

  const [spread, setSpread] = useState<'yes' | 'no' | null>(null);

  const onRequestSpreadNo  = useCallback(() => setSpread('no'),  []);
  const onRequestSpreadYes = useCallback(() => setSpread('yes'), []);
  const onRequestCollapse  = useCallback(() => setSpread(null),  []);

  const [rowInnerWidth, setRowInnerWidth] = useState<number | null>(null);

  const onLayoutRow = useCallback((e: LayoutChangeEvent) => {
    // On web, navigating to another tab hides this one via `display: none`,
    // which fires a zero-width layout. Adopting it would drop facepile members
    // and replay their entering animations upon returning to this tab.
    if (e.nativeEvent.layout.width === 0) {
      return;
    }

    setRowInnerWidth(
      e.nativeEvent.layout.width - 2 * FACEPILE_ROW_PADDING);
  }, []);

  // Per side: answer icon + gap + viewer slot + the visible sliver of each
  // overlapped member; the middle must absorb a spread's step per member,
  // plus breathing room so the piles never read as one
  const fitsMembers = (n: number) =>
    rowInnerWidth !== null
    && rowInnerWidth >=
      2 * (ANSWER_ICON_SIZE + FACEPILE_GROUP_GAP + FACEPILE_AVATAR_SIZE)
      + (2 * (FACEPILE_AVATAR_SIZE - FACEPILE_OVERLAP) + FACEPILE_SPREAD_STEP)
        * n
      + 16;

  const maxMembers =
    rowInnerWidth === null ? (isMobile() ? 3 : 5) :
    fitsMembers(5) ? 5 :
    fitsMembers(4) ? 4 :
    3;

  // The counts include private answers, so publicness is ignored here,
  // unlike in the viewer's pile membership
  const adjustedCount = (countAtFetch: number, answer: boolean) =>
    Math.max(0, countAtFetch
      + (viewerAnswer.answer === answer ? 1 : 0)
      - (fields.question_viewer.answer === answer ? 1 : 0));

  const countYes = adjustedCount(fields.question_count_yes, true);
  const countNo = adjustedCount(fields.question_count_no, false);

  // Each pile reads outward from the card's centre, where the viewer's own
  // avatar (the pile's anchor) sits. The server sends the event's subject
  // first so their face can sit just inside that anchor, closest to the
  // centre. The "yes" pile is start-anchored, so the subject's leading
  // position already puts them there; the "no" pile is end-anchored, so its
  // members are reversed to move the subject to the anchor.
  const yesMembers = fields.question_yes_members.slice(0, maxMembers);
  const noMembers = fields.question_no_members.slice(0, maxMembers).reverse();

  // "No" on the left and "yes" on the right, matching the quiz screen's
  // swipe directions
  return (
    <View style={styles.questionFacepileRow} onLayout={onLayoutRow}>
      <View
        style={[
          styles.questionFacepileGroup,
          spread === 'no' && styles.spreadFacepileGroup,
        ]}
      >
        <AnswerIcon
          answer="no"
          selected={viewerAnswer.answer === false}
          enabled={true}
          onPress={onPressNo}
        />
        <View style={styles.questionFacepileColumn}>
          <Facepile
            members={noMembers}
            viewer={fields.question_viewer}
            viewerVisible={
              viewerAnswer.answer === false && viewerAnswer.public_}
            viewerPosition="end"
            spread={spread === 'no'}
            onRequestSpread={onRequestSpreadNo}
            onRequestCollapse={onRequestCollapse}
          />
          <DefaultText style={{ color: appTheme.hintColor }}>
             No • {formatCount(countNo)}
          </DefaultText>
        </View>
      </View>
      <View
        style={[
          styles.questionFacepileGroup,
          spread === 'yes' && styles.spreadFacepileGroup,
        ]}
      >
        <View
          style={[styles.questionFacepileColumn, { alignItems: 'flex-end' }]}
        >
          <Facepile
            members={yesMembers}
            viewer={fields.question_viewer}
            viewerVisible={
              viewerAnswer.answer === true && viewerAnswer.public_}
            viewerPosition="start"
            spread={spread === 'yes'}
            onRequestSpread={onRequestSpreadYes}
            onRequestCollapse={onRequestCollapse}
          />
          <DefaultText style={{ color: appTheme.hintColor }}>
            {formatCount(countYes)} • Yes
          </DefaultText>
        </View>
        <AnswerIcon
          answer="yes"
          selected={viewerAnswer.answer === true}
          enabled={true}
          onPress={onPressYes}
        />
      </View>
    </View>
  );
};

const FeedItemAnsweredQuestion = ({
  fields
}: {
  fields: AnsweredQuestionFields
}) => {
  const { appTheme } = useAppTheme();

  const onPress = useNavigationToProfile(
    fields.person_uuid,
    fields.photo_blurhash,
  );

  const { backgroundColor, onPressIn, onPressOut } = usePressableAnimation();

  const viewerAnswer = useViewerAnswer(fields.answered_question_id);

  const onPressYes = useCallback(
    () => toggleAnswer(fields.answered_question_id, true),
    [fields.answered_question_id],
  );

  const onPressNo = useCallback(
    () => toggleAnswer(fields.answered_question_id, false),
    [fields.answered_question_id],
  );

  const onChangeAnswerPublicly = useCallback(
    (public_: boolean) => setAnswerPublicly(
      fields.answered_question_id, public_),
    [fields.answered_question_id],
  );

  const quoteText = quizCardQuoteText(
    fields.question_text, fields.question_subject_answer);

  const onPressReply = useNavigationToConversation(
    fields.person_uuid,
    fields.name,
    fields.photo_uuid,
    fields.photo_blurhash,
    quoteText,
    {
      questionId: fields.answered_question_id,
      question: fields.question_text,
      topic: fields.question_topic,
      subjectAnswer: fields.question_subject_answer,
    },
  );

  const props = isMobile() ? {
    onPress,
    onPressIn,
    onPressOut,
  } : {
    disabled: true,
  };

  const extraChildren = (
    <QuestionFacepiles
      // Keying by the card's identity resets the spread state when the
      // native list recycles this component instance for another item
      key={`${fields.person_uuid}:${fields.answered_question_id}`}
      fields={fields}
      viewerAnswer={viewerAnswer}
      onPressNo={onPressNo}
      onPressYes={onPressYes}
    />
  );

  return (
    <View style={styles.pressableStyle}>
      <Animated.View
        style={[
          styles.answeredQuestionCardBorders,
          appTheme.card,
          { backgroundColor },
        ]}
      >
        {/* Only this row navigates to the profile: a card-wide Pressable
            would swallow presses on the checkbox, whose gesture handler
            doesn't take part in the responder negotiation */}
        <Pressable style={styles.answeredQuestionHeader} {...props}>
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
            <ActionTime action="Played Q&A" time={new Date(fields.time)} />
          </View>
        </Pressable>
        <NonInteractiveQuizCard
          questionNumber={fields.answered_question_id}
          topic={fields.question_topic}
          answerPubliclyValue={viewerAnswer.public_}
          onChangeAnswerPublicly={onChangeAnswerPublicly}
          containerStyle={{
            height: undefined,
            width: undefined,
            paddingLeft: 0,
            paddingRight: 0,
          }}
          innerStyle={{
            flexGrow: undefined,
            height: undefined,
            width: '100%',
          }}
          maxFontSize={18}
          extraChildren={extraChildren}
          onPressReply={onPressReply}
        >
          {fields.question_text}
        </NonInteractiveQuizCard>
      </Animated.View>
    </View>
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
            photoUuid={fields.added_photo_uuid}
            photoExtraExts={fields.added_photo_extra_exts}
            photoBlurhash={fields.added_photo_blurhash}
            photoGeometry={fields.added_photo_geometry}
            isPrimary={true}
            borderRadius={12}
            style={styles.addedPhoto}
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
          <ReplyButton onPress={onPressReply} />
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
    case 'answered-question':
      return <FeedItemAnsweredQuestion fields={dataItem} />;
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
  addedPhoto: {
    ...commonStyles.secondaryEnlargeablePhoto,
    marginTop: 0,
    marginBottom: 0,
  },
  pressableStyle: {
    marginBottom: 20,
  },
  facepileColumn: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
  },
  answeredQuestionCardBorders: {
    ...commonStyles.cardBorders,
    flexDirection: 'column',
    gap: 10,
    padding: 10,
  },
  answeredQuestionHeader: {
    flexDirection: 'row',
    gap: 10,
  },
  questionFacepileRow: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    rowGap: 8,
    paddingBottom: 20,
    paddingLeft: FACEPILE_ROW_PADDING,
    paddingRight: FACEPILE_ROW_PADDING,
  },
  questionFacepileColumn: {
    alignItems: 'flex-start',
    gap: 4,
  },
  questionFacepileGroup: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: FACEPILE_GROUP_GAP,
  },
  spreadFacepileGroup: {
    zIndex: 1,
  },
  facepileImage: {
    height: FACEPILE_AVATAR_SIZE,
    width: FACEPILE_AVATAR_SIZE,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
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
