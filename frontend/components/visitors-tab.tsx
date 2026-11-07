import {
  Platform,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { Pressable } from './pressable';
import { LogoActivityIndicator } from './logo/logo-activity-indicator';
import { memo, useCallback, useState, useRef } from 'react';
import { DefaultText } from './default-text';
import { TopNavBar } from './top-nav-bar';
import { useScrollbar } from './navigation/scroll-bar-hooks';
import { Avatar } from './avatar';
import { commonStyles } from '../styles';
import { VerificationBadge } from './verification-badge';
import { useFocusEffect } from '@react-navigation/native';
import { useSkipped } from '../hide-and-block/hide-and-block';
import { useAppTheme } from '../app-theme/app-theme';
import { usePressableAnimation } from '../animation/animation';
import { ButtonGroup } from './button-group';
import Animated from 'react-native-reanimated';
import { notify } from '../events/events';
import {
  format,
  isThisYear,
  isToday,
  isYesterday,
} from 'date-fns'
import { ReportModalInitialData } from './modal/report-modal';
import { ReportFlag } from './report-flag';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faGhost } from '@fortawesome/free-solid-svg-icons/faGhost';
import { useTooltip } from './tooltip';
import { happenedInLast7Days } from '../util/util';
import { useProfileLink } from '../navigation/use-profile-link';
import {
  DataItem,
  SectionKey,
  markVisitorChecked,
  markVisitorsChecked,
  suppressYouVisitedReorder,
  useLastVisitedAt,
  useVisitorDataItem,
  useVisitorKeys,
} from '../chat/application-layer/hooks/visitors';

const friendlyTimestamp = (date: Date): string => {
  if (isToday(date)) {
    // Format as 'hh:mm'
    return 'Today, ' + format(date, 'h:mm aaa')
  } else if (isYesterday(date)) {
    // Format as 'hh:mm'
    return 'Yesterday, ' + format(date, 'h:mm aaa')
  } else if (happenedInLast7Days(date)) {
    // Format as 'eeee' (day of the week)
    return format(date, 'eeee, h:mm aaa')
  } else if (isThisYear(date)) {
    // Format as 'd MMM' (date and month)
    return format(date, 'd MMM, h:mm aaa')
  } else {
    // Format as 'd MMM yyyy' (date, month and year)
    return format(date, 'd MMM yyyy, h:mm aaa')
  }
};


const sectionFromKey = (itemKey: string): SectionKey =>
  itemKey.startsWith('you_visited-') ? 'you_visited' : 'visited_you';

const VisitorsItem = ({ itemKey }: { itemKey: string }) => {
  const dataItem = useVisitorDataItem(itemKey);

  if (!dataItem) {
    return null;
  }

  return (
    <VisitorsItemContent dataItem={dataItem} section={sectionFromKey(itemKey)} />
  );
};

const VisitorsItemContent = ({
  dataItem,
  section,
}: {
  dataItem: DataItem;
  section: SectionKey;
}) => {
  const { appTheme } = useAppTheme();

  const { isSkipped } = useSkipped(dataItem.person_uuid);
  const {
    backgroundStyle,
    onPressIn,
    onPressOut,
    hoverProps,
  } = usePressableAnimation();
  const onVisit = useCallback(() => {
    markVisitorChecked(dataItem.person_uuid);

    // Opening a profile straight from the "You Visited" list shouldn't yank it
    // to the top when you navigate back; suppress that one reorder.
    if (section === 'you_visited') {
      suppressYouVisitedReorder(dataItem.person_uuid);
    }
  }, [dataItem.person_uuid, section]);
  const profileLink = useProfileLink(
    dataItem.person_uuid,
    dataItem.url_slug,
    dataItem.photo_blurhash,
    dataItem.verification_required_to_view,
    onVisit,
  );
  const { viewRef, props } = useTooltip('You were invisible');

  const onPressReport = useCallback(() => {
    const data: ReportModalInitialData = {
      name: dataItem.name,
      personUuid: dataItem.person_uuid,
      context: 'Visitors',
    };
    notify('open-report-modal', data);
  }, [dataItem.name, dataItem.person_uuid]);

  if (isSkipped) {
    return <></>;
  }

  return (
    <Pressable
      style={styles.pressableStyle}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      {...profileLink}
      {...hoverProps}
    >
      <Animated.View style={[styles.cardBorders, appTheme.card, backgroundStyle]}>
        <Avatar
          percentage={dataItem.match_percentage}
          personUuid={dataItem.person_uuid}
          urlSlug={dataItem.url_slug}
          photoUuid={dataItem.photo_uuid}
          photoBlurhash={dataItem.photo_blurhash}
          verificationRequired={dataItem.verification_required_to_view}
          disableProfileNavigation={true}
        />
        <View style={{ flexShrink: 1, gap: 2 }} >
          <View
            style={{
              width: '100%',
              flexDirection: 'row',
              gap: 5,
              alignItems: 'center',
            }}
          >
            <DefaultText
              style={{
                fontWeight: '700',
                flexShrink: 1,
              }}
            >
              {dataItem.name}
            </DefaultText>
            {dataItem.is_verified &&
              <VerificationBadge size={14} />
            }
          </View>
          <DefaultText style={{ color: appTheme.hintColor }}>
            {
              [
                dataItem.age,
                dataItem.gender,
              ]
                .filter(Boolean)
                .join(' • ')
            }
          </DefaultText>
          {dataItem.location &&
            <DefaultText style={{ color: appTheme.hintColor }}>
              {dataItem.location}
            </DefaultText>
          }
          <DefaultText style={{ marginTop: 20, color: appTheme.hintColor }}>
            {friendlyTimestamp(new Date(dataItem.time))}
          </DefaultText>
        </View>
        <View
          style={{
            flexGrow: 1,
            alignItems: 'flex-end',
            marginRight: 5,
          }}
        >
          {dataItem.is_new &&
            <View
              style={{
                backgroundColor: appTheme.brandColor,
                height: 12,
                width: 12,
                borderRadius: 999,
              }}
            />
          }
          {dataItem.was_invisible &&
            <View
              ref={viewRef}
              {...props}
            >
              <FontAwesomeIcon
                icon={faGhost}
                size={22}
                style={{ color: appTheme.brandColor }}
              />
            </View>
          }
        </View>
        <ReportFlag
          onPress={onPressReport}
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
          }}
        />
      </Animated.View>
    </Pressable>
  );
};

const VisitorsItemMemo = memo(VisitorsItem);

const RenderItem = ({ item }: { item: string }) => {
  return <VisitorsItemMemo itemKey={item} />
};

const keyExtractor = (id: string) => id;

const VisitorsTab = () => {
  const { appTheme } = useAppTheme();
  const {
    onLayout,
    onContentSizeChange,
    onScroll,
    showsVerticalScrollIndicator,
    observeListRef,
  } = useScrollbar('visitors');

  const [sectionIndex, setSectionIndex] = useState(0);

  const visitedYouKeys = useVisitorKeys('visited_you');
  const youVisitedKeys = useVisitorKeys('you_visited');
  const keys = sectionIndex === 0 ? visitedYouKeys : youVisitedKeys;
  const lastVisitedAt = useLastVisitedAt();
  const lastMarkedCheckAt = useRef<string>(null);

  const maybeMarkVisitorsChecked = useCallback(() => {
    if (!lastVisitedAt) {
      return;
    }

    if (lastVisitedAt === lastMarkedCheckAt.current) {
      return;
    }

    markVisitorsChecked(lastVisitedAt);

    lastMarkedCheckAt.current = lastVisitedAt;
  }, [lastVisitedAt]);

  const focusEffect = useCallback(() => {
    maybeMarkVisitorsChecked();

    return maybeMarkVisitorsChecked
  }, [maybeMarkVisitorsChecked])

  useFocusEffect(focusEffect);

  const emptyText = sectionIndex === 0 ? (
    "Nobody’s visited your profile yet. Try answering more Q&A questions or " +
    "updating your profile"
  ) : (
    "You haven’t visited anybody’s profile recently"
  );

  const endText = sectionIndex === 0 ? (
    "That’s everybody who’s visited you recently"
  ) : (
    "That’s everybody you’ve visited recently"
  );

  return (
    <View style={styles.safeAreaView}>
      <TopNavBar>
        <DefaultText
          style={{
            fontWeight: '700',
            fontSize: 20,
          }}
        >
          Visitors
        </DefaultText>
      </TopNavBar>
      {!keys &&
        <View style={{height: '100%', justifyContent: 'center', alignItems: 'center'}}>
          <LogoActivityIndicator size="large" color={appTheme.brandColor} />
        </View>
      }
      {!!keys &&
        <View style={styles.flatListContainer} onLayout={onLayout}>
          <Animated.FlatList<string>
            ref={observeListRef}
            data={keys}
            ListHeaderComponent={
              <ButtonGroup
                buttons={[
                  'Visited You',
                  'You Visited',
                ]}
                selectedIndex={sectionIndex}
                onPress={setSectionIndex}
                containerStyle={{
                  marginTop: 5,
                  marginLeft: 20,
                  marginRight: 20,
                }}
              />
            }
            ListEmptyComponent={
              <DefaultText style={styles.emptyText}>
                {emptyText}
              </DefaultText>
            }
            ListFooterComponent={
              keys.length > 0 ?
                <DefaultText style={styles.endText}>{endText}</DefaultText> :
                null
            }
            renderItem={RenderItem}
            keyExtractor={keyExtractor}
            windowSize={11}
            onContentSizeChange={onContentSizeChange}
            onScroll={onScroll}
            showsVerticalScrollIndicator={showsVerticalScrollIndicator}
            style={listStyle}
            contentContainerStyle={styles.listContentContainerStyle}
          />
        </View>
      }
    </View>
  );
};

const listStyle: ViewStyle & { overflowAnchor?: 'none' } =
  Platform.OS === 'web' ? { overflowAnchor: 'none' } : {};

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
    alignItems: 'center',
    width: '100%',
  },
  pressableStyle: {
    marginTop: 20,
    width: '100%',
  },
  flatListContainer: {
    flex: 1,
  },
  emptyText: {
    fontFamily: 'Trueno',
    margin: '20%',
    textAlign: 'center',
  },
  endText: {
    fontFamily: 'TruenoBold',
    fontSize: 16,
    textAlign: 'center',
    alignSelf: 'center',
    marginTop: 30,
    marginBottom: 30,
    marginLeft: '15%',
    marginRight: '15%',
  }
});

export {
  VisitorsTab,
};
