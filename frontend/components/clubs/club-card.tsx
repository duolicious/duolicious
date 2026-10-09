import { ComponentProps, memo, useEffect, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { ImageBackground } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { japi } from '../../api/api';
import * as Clipboard from 'expo-clipboard';
import { IMAGES_URL, INVITE_URL } from '../../env/env';
import { useSignedInUser } from '../../events/signed-in-user';
import { useAppTheme } from '../../app-theme/app-theme';
import { isMobile } from '../../util/util';
import {
  ClubItem,
  RowPosition,
  clubQuota,
  joinClub,
  leaveClub,
  memberCountNow,
  useIsClubMember,
  useJoinedClubs,
} from '../../club/club';
import { Avatar, useProfileLink } from '../avatar';
import { Close } from '../button/close';
import { usePressableAnimation } from '../../animation/animation';
import { Club } from '../club';
import { DefaultText } from '../default-text';
import { Skeleton } from '../skeleton';
import { VerificationBadge } from '../verification-badge';
import { ButtonWithCenteredText } from '../button/centered-text';
import { LogoActivityIndicator } from '../logo/logo-activity-indicator';
import { showPointOfSale } from '../modal/point-of-sale-modal';
import { notifyErrorToast, notifyLinkCopiedToast } from '../toast';

const MAX_MEMBERS = 25;

const onPressInvite = (clubName: string) => async () => {
  await Clipboard.setStringAsync(
    `${INVITE_URL}/${encodeURIComponent(clubName)}`);
  notifyLinkCopiedToast('Invite Link Copied!');
};

type ClubMember = {
  person_uuid: string,
  url_slug: string | null,
  name: string,
  age: number | null,
  gender: string | null,
  location: string | null,
  is_verified: boolean,
  match_percentage: number,
  verification_required_to_view: 'basics' | 'photos' | null,
  photo_uuid: string | null,
  photo_blurhash: string | null,
};

type ClubCard = {
  count_members: number,
  related_clubs: ClubItem[],
  members: ClubMember[],
};

const useClubCard = (
  name: string,
  isMember: boolean,
): ClubCard | 'error' | null => {
  const [card, setCard] =
    useState<ClubCard & { wasMember: boolean } | 'error' | null>(null);

  const isMemberRef = useRef(isMember);
  isMemberRef.current = isMember;

  useEffect(() => {
    let isCurrent = true;
    const wasMember = isMemberRef.current;

    (async () => {
      const response = await japi<ClubCard>(
        'get', `/club-card?name=${encodeURIComponent(name)}`);

      if (isCurrent) {
        setCard(response.ok && response.json
          ? { ...response.json, wasMember }
          : 'error');
      }
    })();

    return () => { isCurrent = false; };
  }, [name]);

  return card === null || card === 'error' ? card : {
    ...card,
    count_members: memberCountNow(card.count_members, card.wasMember, isMember),
  };
};

const memberCountText = (n: number) => {
  if (n === 0) {
    return 'No members yet';
  }
  return n === 1 ? '1 member' : `${n.toLocaleString()} members`;
};

const Facepile = ({ members }: { members: ClubMember[] }) => {
  const { appTheme } = useAppTheme();

  return (
    <View style={{ flexDirection: 'row' }}>
      {members.map((m, i) =>
        <ImageBackground
          key={m.person_uuid}
          source={{
            uri: `${IMAGES_URL}/450-${m.photo_uuid}.jpg`,
            height: 450,
            width: 450,
          }}
          placeholder={m.photo_blurhash && { blurhash: m.photo_blurhash }}
          transition={150}
          contentFit="cover"
          style={[
            styles.face,
            {
              marginLeft: i === 0 ? 0 : -8,
              borderColor: appTheme.primaryColor,
              backgroundColor: appTheme.avatarBackgroundColor,
            },
          ]}
        />
      )}
    </View>
  );
};

const RelatedClubs = ({
  clubs,
  onPressClub,
}: {
  clubs: ClubItem[],
  onPressClub: (name: string) => void,
}) => {
  const joined = new Set(useJoinedClubs());

  const chips = (isMobile() ? clubs : clubs.slice(0, 6)).map((c) =>
    <Club
      key={c.name}
      name={c.name}
      isMutual={joined.has(c.name)}
      textStyle={{ fontSize: 13 }}
      onPress={() => onPressClub(c.name)}
    />
  );

  return (
    <>
      <DefaultText style={styles.sectionTitle}>Related clubs</DefaultText>
      {isMobile()
        ? <ScrollView
            horizontal={true}
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -20 }}
            contentContainerStyle={{ gap: 6, paddingHorizontal: 20 }}
          >
            {chips}
          </ScrollView>
        : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {chips}
          </View>
      }
    </>
  );
};

const SummarySkeleton = () =>
  <>
    <View style={styles.summary}>
      <Skeleton style={{ width: 92, height: 26, borderRadius: 999 }} />
      <Skeleton style={{ width: 90, height: 16, borderRadius: 4 }} />
    </View>
    <DefaultText style={styles.sectionTitle}>Related clubs</DefaultText>
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {[70, 90, 120].map((width) =>
        <Skeleton key={width} style={{ width, height: 31, borderRadius: 999 }} />
      )}
    </View>
  </>;

const IconLabel = ({
  icon,
  label,
  secondary,
}: {
  icon: ComponentProps<typeof Ionicons>['name'],
  label: string,
  secondary: boolean,
}) => {
  const { appTheme } = useAppTheme();
  const color = secondary ? appTheme.secondaryColor : '#ffffff';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Ionicons name={icon} style={{ fontSize: 20, color }} />
      <DefaultText style={{ fontSize: 16, color }}>{label}</DefaultText>
    </View>
  );
};

const MemberRow = memo(({ member }: { member: ClubMember }) => {
  const { appTheme } = useAppTheme();
  const profileLink = useProfileLink(
    member.person_uuid,
    member.url_slug,
    member.photo_blurhash,
    member.verification_required_to_view,
  );
  const { backgroundStyle, onPressIn, onPressOut, hoverProps } =
    usePressableAnimation();

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      {...hoverProps}
      {...profileLink}
    >
      <Animated.View style={[styles.memberRow, backgroundStyle]}>
        <Avatar
          size={64}
          percentage={member.match_percentage}
          personUuid={member.person_uuid}
          urlSlug={member.url_slug}
          photoUuid={member.photo_uuid}
          photoBlurhash={member.photo_blurhash}
          verificationRequired={member.verification_required_to_view}
          disableProfileNavigation={true}
        />
        <View style={{ flexShrink: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
            <DefaultText style={{ fontWeight: '700', flexShrink: 1 }}>
              {member.name}
            </DefaultText>
            {member.is_verified && <VerificationBadge size={14} />}
          </View>
          <DefaultText style={{ color: appTheme.hintColor }}>
            {[member.age, member.gender].filter(Boolean).join(' • ')}
          </DefaultText>
          {member.location &&
            <DefaultText style={{ color: appTheme.hintColor }}>
              {member.location}
            </DefaultText>
          }
        </View>
      </Animated.View>
    </Pressable>
  );
});

const ClubCardTitle = ({
  name,
  isScrolled,
  onClose,
}: {
  name: string,
  isScrolled: boolean,
  onClose?: () => void,
}) => {
  const { appTheme } = useAppTheme();

  return (
    <View
      style={[
        styles.title,
        { borderBottomColor: isScrolled ? appTheme.inputColor : 'transparent' },
      ]}
    >
      <DefaultText
        style={{
          fontFamily: 'TruenoBold',
          fontSize: 28,
          lineHeight: 34,
          flexShrink: 1,
        }}
      >
        {name}
      </DefaultText>
      {onClose && <Close onPress={onClose} style={{ position: 'relative' }} />}
    </View>
  );
};

const ClubCardBody = ({
  name,
  isOpened,
  rowPosition,
  onPressClub,
  onScroll,
}: {
  name: string,
  isOpened: boolean,
  rowPosition: RowPosition,
  onPressClub: (name: string) => void,
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void,
}) => {
  const { appTheme } = useAppTheme();
  const [signedInUser] = useSignedInUser();
  const isMember = useIsClubMember(name);
  const response = useClubCard(name, isMember);
  const fetched = isOpened ? response : null;
  const card = fetched === 'error' ? null : fetched;

  const members = card?.members ?? [];
  const faces = members.filter((m) => m.photo_uuid).slice(0, 5);
  const countMembers = card?.count_members ?? 0;
  const countHidden = isMember || members.length < MAX_MEMBERS
    ? 0
    : countMembers - members.length;

  const onPressJoin = () => {
    if (joinClub(name, rowPosition)) {
      return;
    }
    if (signedInUser?.hasGold) {
      return notifyErrorToast(`You can join up to ${clubQuota()} clubs`);
    }
    showPointOfSale('clubs');
  };

  const header = (
    <View style={{ paddingBottom: 18 }}>
      {fetched === 'error' &&
        <DefaultText style={{ marginTop: 8, color: appTheme.hintColor }}>
          Couldn’t load this club. Try again later.
        </DefaultText>
      }
      {fetched === null && <SummarySkeleton />}
      {card !== null &&
        <>
          <View style={styles.summary}>
            {faces.length > 0 && <Facepile members={faces} />}
            <DefaultText style={{ fontWeight: '600' }}>
              {memberCountText(countMembers)}
            </DefaultText>
          </View>
          {card.related_clubs.length > 0 &&
            <RelatedClubs
              clubs={card.related_clubs}
              onPressClub={onPressClub}
            />
          }
        </>
      }
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
        <ButtonWithCenteredText
          containerStyle={styles.button}
          secondary={isMember}
          onPress={isMember ? () => leaveClub(name) : onPressJoin}
          extraChildren={
            <IconLabel
              icon={isMember ? 'log-out-outline' : 'add'}
              label={isMember ? 'Leave' : 'Join'}
              secondary={isMember}
            />
          }
        />
        <ButtonWithCenteredText
          containerStyle={styles.button}
          secondary={true}
          onPress={onPressInvite(name)}
          extraChildren={
            <IconLabel icon="person-add-outline" label="Invite" secondary={true} />
          }
        />
      </View>
    </View>
  );

  const footer = (
    <View style={{ paddingVertical: 20 }}>
      {fetched === null &&
        <View style={{ alignItems: 'center' }}>
          <LogoActivityIndicator size="large" color={appTheme.brandColor} />
        </View>
      }
      {countHidden > 0 &&
        <View style={styles.joinPrompt}>
          <DefaultText style={{ fontWeight: '700', fontSize: 16, textAlign: 'center' }}>
            {countHidden.toLocaleString()}
            {countHidden === 1 ? ' more person is in ' : ' more people are in '}
            {name}
          </DefaultText>
          <DefaultText style={{ color: appTheme.hintColor }}>
            Join to see them all.
          </DefaultText>
          <ButtonWithCenteredText
            containerStyle={{ alignSelf: 'stretch', marginTop: 10 }}
            onPress={onPressJoin}
            extraChildren={<IconLabel icon="add" label="Join" secondary={false} />}
          />
        </View>
      }
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: 20 }}
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      {header}
      {members.map((m) => <MemberRow key={m.person_uuid} member={m} />)}
      {footer}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  title: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 20,
    paddingBottom: 6,
    borderBottomWidth: 1,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  face: {
    width: 26,
    height: 26,
    borderRadius: 999,
    borderWidth: 2,
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 14,
    marginBottom: 6,
  },
  button: {
    flex: 1,
    marginTop: 0,
    marginBottom: 0,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 5,
    marginHorizontal: -10,
    paddingHorizontal: 10,
    borderRadius: 15,
  },
  joinPrompt: {
    paddingTop: 10,
    alignItems: 'center',
    gap: 6,
  },
});

export {
  ClubCardBody,
  ClubCardTitle,
};
