import {
  ActivityIndicator,
  ListRenderItemInfo,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { LogoActivityIndicator } from './logo/logo-activity-indicator';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useConversation } from '../chat/application-layer/hooks/conversation';
import { refreshInbox } from '../chat/application-layer';
import { TopNavBar } from './top-nav-bar';
import { IntrosItem, ChatsItem, HiddenIntrosItem } from './inbox-item';
import { DefaultText } from './default-text';
import { ButtonGroup } from './button-group';
import { useInboxStats } from '../chat/application-layer/hooks/inbox-stats';
import {
  MIN_INTROS_TO_APPLY_SEARCH_FILTERS,
  setInboxSettings,
  useConversations,
  useInboxSettings,
} from '../chat/application-layer/hooks/conversations';
import { TopNavBarButton } from './top-nav-bar-button';
import { listen } from '../events/events';
import { consumeStaleInbox } from '../events/stale-inbox';
import { flushSearchFilterWrites } from '../events/search-filters';
import { seenInboxFilterHint } from '../kv-storage/seen-hints/seen-inbox-filter-hint';
import { InboxFilterHint } from './hints/inbox-filter-hint';
import { useFocusEffect } from '@react-navigation/native';
import { useScrollbar } from './navigation/scroll-bar-hooks';
import { useAppTheme } from '../app-theme/app-theme';
import { useSignedInUser } from '../events/signed-in-user';
import { sentMessagesInChats } from '../util/trials';

const INBOX_PANEL_HEADER_HEIGHT = 48;

const IntrosItemMemo = memo(IntrosItem);
const ChatsItemMemo = memo(ChatsItem);

const hideHiddenIntros = () => setInboxSettings({ showHidden: false });

const HiddenIntrosBackButton = ({ position }: { position: 'left' | null }) => (
  <TopNavBarButton
    onPress={hideHiddenIntros}
    iconName="arrow-back"
    position={position}
    secondary={true}
  />
);

type InboxListItem = string | { dividerKey: string, label: string };

const InboxDivider = ({ label }: { label: string }) => {
  const { appTheme } = useAppTheme();

  const lineStyle = [
    styles.dividerLine,
    { backgroundColor: appTheme.secondaryColor },
  ];

  return (
    <View style={styles.divider}>
      <View style={lineStyle} />
      <DefaultText style={styles.dividerText}>
        {label}
      </DefaultText>
      <View style={lineStyle} />
    </View>
  );
};

const RenderItem = ({ item, isOpen }: { item: string, isOpen: boolean }) => {
  const conversation = useConversation(item);

  if (!conversation) {
    return <></>;
  } else if (conversation.location === 'intros') {
    return <IntrosItemMemo
      wasRead={conversation.lastMessageRead}
      name={conversation.name}
      personUuid={conversation.personUuid}
      urlSlug={conversation.urlSlug}
      photoUuid={conversation.photoUuid}
      photoBlurhash={conversation.photoBlurhash}
      matchPercentage={conversation.matchPercentage}
      lastMessage={conversation.lastMessage}
      lastMessageTimestamp={conversation.lastMessageTimestamp}
      isAvailableUser={conversation.isAvailableUser}
      isVerified={conversation.isVerified}
      isOpen={isOpen}
    />
  } else {
    return <ChatsItemMemo
      wasRead={conversation.lastMessageRead}
      name={conversation.name}
      personUuid={conversation.personUuid}
      urlSlug={conversation.urlSlug}
      photoUuid={conversation.photoUuid}
      photoBlurhash={conversation.photoBlurhash}
      matchPercentage={conversation.matchPercentage}
      lastMessage={conversation.lastMessage}
      lastMessageTimestamp={conversation.lastMessageTimestamp}
      isAvailableUser={conversation.isAvailableUser}
      isVerified={conversation.isVerified}
      isOpen={isOpen}
    />
  }
};

const keyExtractor = (item: InboxListItem) =>
  typeof item === 'string' ? item : item.dividerKey;

const InboxList = ({ openPersonUuid, scrollbar }: {
  openPersonUuid?: string
  scrollbar?: ReturnType<typeof useScrollbar>
}) => {
  const { appTheme } = useAppTheme();
  const [signedInUser] = useSignedInUser();

  const {
    conversations,
    numAboveDivider,
    sectionIndex,
    sortByIndex,
    showArchive,
    showHidden,
    numHidden,
  } = useConversations();

  const stats = useInboxStats();

  const numUnreadIntros = stats?.numUnreadIntros ?? 0;
  const numUnreadChats  = stats?.numUnreadChats  ?? 0;

  const introsNumericalLabel = (
    numUnreadIntros ?
      ` (${numUnreadIntros})` :
      '');
  const chatsNumericalLabel = (
    numUnreadChats  ?
    ` (${numUnreadChats})` :
    '');

  const listData = useMemo<InboxListItem[] | null>(() => {
    if (conversations === null) {
      return null;
    }

    if (numAboveDivider === null) {
      return conversations;
    }

    if (sectionIndex === 1) {
      return [
        ...conversations.slice(0, numAboveDivider),
        { dividerKey: 'divider-sent', label: 'Intros you sent' },
        ...conversations.slice(numAboveDivider),
      ];
    }

    const numWithin = numAboveDivider;
    const numOutside = conversations.length - numWithin;

    const items: InboxListItem[] = [];

    if (numWithin > 0) {
      items.push({
        dividerKey: 'divider-matching',
        label: `Within your search filters (${numWithin})`,
      });
      items.push(...conversations.slice(0, numWithin));
    }

    if (numOutside > 0) {
      items.push({
        dividerKey: 'divider-outside',
        label: `Outside your search filters (${numOutside})`,
      });
      items.push(...conversations.slice(numWithin));
    }

    return items;
  }, [conversations, numAboveDivider, sectionIndex]);

  const emptyText = (() => {
    if (showHidden)
      return 'No hidden intros to show';
    if (!showArchive && sectionIndex === 0)
      return (
        'This is where you’ll see messages from people who’ve reached out ' +
        'to you first – Once you reply, they’ll move to your Chats\xa0💬'
      );
    if (!showArchive && sectionIndex === 1 && sentMessagesInChats(signedInUser?.personId))
      return (
        'This is where you’ll see your conversations – Messages you send ' +
        'appear here straight away, even before anyone replies\xa0💬'
      );
    if (!showArchive && sectionIndex === 1)
      return (
        'This is where you’ll see active conversations – Chats start once ' +
        'both people have exchanged messages\xa0💬'
      );
    if (showArchive)
      return 'No archived conversations to show';
    throw Error('Unhandled inbox section');
  })();

  const endText = (() => {
    if (showArchive) {
      return 'No more archived conversations to show';
    } else if (showHidden) {
      return 'No more hidden intros';
    } else {
      if (sectionIndex === 0) {
        return 'Those are all the intros you have for now';
      } else {
        return 'No more chats to show';
      }
    }
  })();

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<InboxListItem>) =>
      typeof item === 'string'
        ? <RenderItem item={item} isOpen={item === openPersonUuid} />
        : <InboxDivider label={item.label} />,
    [openPersonUuid],
  );

  if (listData === null) {
    return (
      <View style={{height: '100%', justifyContent: 'center', alignItems: 'center'}}>
        <LogoActivityIndicator size="large" color={appTheme.brandColor} />
      </View>
    );
  }

  return (
    <View style={styles.flatListContainer} onLayout={scrollbar?.onLayout}>
      <Animated.FlatList<InboxListItem>
        ref={scrollbar?.observeListRef}
        data={listData}
        ListHeaderComponent={<>{
          showHidden &&
            <DefaultText style={styles.hiddenSubtitle}>
              These intros might be rude
            </DefaultText>
        }{
          !showArchive && !showHidden && <>
            <ButtonGroup
              buttons={[
                'Intros' + introsNumericalLabel,
                'Chats'  + chatsNumericalLabel
              ]}
              selectedIndex={sectionIndex}
              onPress={(sectionIndex) => setInboxSettings({ sectionIndex })}
              containerStyle={{
                marginTop: 5,
                marginLeft: 20,
                marginRight: 20,
              }}
            />
            <ButtonGroup
              buttons={['Best Matches First', 'Latest First']}
              selectedIndex={sortByIndex}
              onPress={(sortByIndex) => setInboxSettings({ sortByIndex })}
              secondary={true}
              disabled={sectionIndex === 1}
              containerStyle={{
                flexGrow: 1,
                marginLeft: 20,
                marginRight: 20,
              }}
            />
          </>
        }</>}
        ListEmptyComponent={
          <DefaultText style={styles.emptyText}>
            {emptyText}
          </DefaultText>
        }
        ListFooterComponent={<>
          {!showArchive && !showHidden && sectionIndex === 0 && numHidden > 0 && <>
            {numAboveDivider !== null &&
              <InboxDivider label={`Hidden (${numHidden})`} />
            }
            <HiddenIntrosItem count={numAboveDivider === null ? numHidden : null} />
          </>}
          {listData.length > 0 &&
            <DefaultText style={styles.endText}>{endText}</DefaultText>
          }
        </>}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        onContentSizeChange={scrollbar?.onContentSizeChange}
        onScroll={scrollbar?.onScroll}
        showsVerticalScrollIndicator={scrollbar?.showsVerticalScrollIndicator}
        contentContainerStyle={styles.flatList}
      />
    </View>
  );
};

const InboxTitle = () => {
  const { appTheme } = useAppTheme();
  const { showArchive, showHidden } = useInboxSettings();
  const [isOnline, setIsOnline] = useState(false);

  useLayoutEffect(() => {
    return listen<boolean>(
      'chat-is-online',
      (data) => setIsOnline(data ?? false),
      true,
    );
  }, []);

  return (
    <View>
      <DefaultText
        style={{
          fontWeight: '700',
          fontSize: 20,
        }}
      >
        {showHidden ? 'Hidden intros' : 'Inbox' + (showArchive ? ' (Archive)' : '')}
      </DefaultText>
      {!isOnline &&
        <ActivityIndicator
          size="small"
          color={appTheme.brandColor}
          style={{
            position: 'absolute',
            right: -40,
            top: 3,
          }}
        />
      }
    </View>
  );
};

const InboxNavBarButtons = ({ style }: { style: ViewStyle }) => {
  const {
    sectionIndex,
    showArchive,
    showHidden,
    applySearchFilters,
  } = useInboxSettings();

  const stats = useInboxStats();

  const [isRefreshingInbox, setIsRefreshingInbox] = useState(false);

  const numIntros = stats?.numIntros ?? 0;

  const canApplySearchFilters =
    sectionIndex === 0 &&
    numIntros >= MIN_INTROS_TO_APPLY_SEARCH_FILTERS;

  const [isFilterHintDismissed, setIsFilterHintDismissed] = useState(true);

  useEffect(() => {
    (async () => {
      if (!(await seenInboxFilterHint())) {
        setIsFilterHintDismissed(false);
      }
    })();
  }, []);

  const dismissFilterHint = useCallback(() => {
    setIsFilterHintDismissed(true);
    seenInboxFilterHint(true);
  }, []);

  const onPressFilterButton = useCallback(() => {
    dismissFilterHint();
    setInboxSettings({ applySearchFilters: !applySearchFilters });
  }, [applySearchFilters]);

  const onPressArchiveButton = useCallback(() => {
    setInboxSettings({ showArchive: !showArchive });
  }, [showArchive]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        await flushSearchFilterWrites();
        if (active && consumeStaleInbox()) {
          setIsRefreshingInbox(true);
          refreshInbox().finally(() => setIsRefreshingInbox(false));
        }
      })();
      return () => { active = false; };
    }, [])
  );

  if (showHidden) {
    return null;
  }

  return (
    <View style={style}>
      {!showArchive && canApplySearchFilters &&
        <Animated.View entering={FadeIn} exiting={FadeOut}>
          <TopNavBarButton
            onPress={onPressFilterButton}
            iconName={applySearchFilters ? 'funnel' : 'funnel-outline'}
            overlayIconName={applySearchFilters ? 'checkmark-circle' : undefined}
            position={null}
            secondary={false}
            label="Filter"
            loading={isRefreshingInbox}
          />
          {!isFilterHintDismissed &&
            <InboxFilterHint onDismiss={dismissFilterHint} />
          }
        </Animated.View>
      }
      <TopNavBarButton
        onPress={onPressArchiveButton}
        iconName={showArchive ? 'chatbubbles-outline' : 'file-tray-full-outline'}
        position={null}
        secondary={false}
        label={showArchive ? "Inbox" : "Archive"}
        style={styles.archiveButton}
      />
    </View>
  );
};

const InboxTab = () => {
  const scrollbar = useScrollbar('inbox');
  const { showHidden } = useInboxSettings();

  return (
    <View style={styles.safeAreaView}>
      <TopNavBar>
        {showHidden && <HiddenIntrosBackButton position="left" />}
        <InboxTitle />
        <InboxNavBarButtons style={styles.navBarButtons} />
      </TopNavBar>
      <InboxList scrollbar={scrollbar} />
    </View>
  );
};

const InboxPanel = memo(({ openPersonUuid }: { openPersonUuid?: string }) => {
  const { showHidden } = useInboxSettings();

  return (
    <>
      <View style={styles.panelHeader}>
        <View style={styles.panelTitle}>
          {showHidden && <HiddenIntrosBackButton position={null} />}
          <InboxTitle />
        </View>
        <InboxNavBarButtons style={styles.panelButtons} />
      </View>
      <InboxList openPersonUuid={openPersonUuid} />
    </>
  );
});

const styles = StyleSheet.create({
  safeAreaView: {
    flex: 1
  },
  flatList: {
    paddingTop: 10,
    alignItems: 'stretch',
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
  },
  flatListContainer: {
    flex: 1,
  },
  emptyText: {
    fontFamily: 'Trueno',
    margin: '20%',
    textAlign: 'center',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 20,
    marginBottom: 10,
    marginLeft: 20,
    marginRight: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontFamily: 'TruenoBold',
    fontSize: 13,
    textAlign: 'center',
    flexShrink: 1,
  },
  navBarButtons: {
    position: 'absolute',
    top: 0,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    right: 10,
  },
  panelHeader: {
    height: INBOX_PANEL_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 10,
  },
  panelTitle: {
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  panelButtons: {
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Spacing lives here rather than as `gap` on navBarButtons because
  // reanimated's exiting animation positions the leaving filter button as if
  // the row had no gap, making it jump flush against this button.
  archiveButton: {
    marginLeft: 14,
  },
  hiddenSubtitle: {
    color: 'grey',
    textAlign: 'center',
    marginBottom: 10,
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

export { INBOX_PANEL_HEADER_HEIGHT, InboxList, InboxPanel, InboxTab };
