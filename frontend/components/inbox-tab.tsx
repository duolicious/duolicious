import {
  ActivityIndicator,
  ListRenderItemInfo,
  StyleSheet,
  View,
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
import { IntrosItem, ChatsItem } from './inbox-item';
import { DefaultText } from './default-text';
import { ButtonGroup } from './button-group';
import { useInboxStats } from '../chat/application-layer/hooks/inbox-stats';
import {
  MIN_INTROS_TO_APPLY_SEARCH_FILTERS,
  useConversations,
} from '../chat/application-layer/hooks/conversations';
import { TopNavBarButton } from './top-nav-bar-button';
import {
  inboxApplySearchFilters,
  inboxOrder,
  inboxSection,
} from '../kv-storage/inbox';
import { listen } from '../events/events';
import { consumeStaleInbox } from '../events/stale-inbox';
import { seenInboxFilterHint } from '../kv-storage/seen-inbox-filter-hint';
import { InboxFilterHint } from './inbox-filter-hint';
import { useFocusEffect } from '@react-navigation/native';
import { useScrollbar } from './navigation/scroll-bar-hooks';
import { useAppTheme } from '../app-theme/app-theme';

const IntrosItemMemo = memo(IntrosItem);
const ChatsItemMemo = memo(ChatsItem);

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

const RenderItem = ({ item }: { item: string }) => {
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
    />
  } else {
    return <ChatsItemMemo
      wasRead={conversation.lastMessageRead}
      name={conversation.name}
      personUuid={conversation.personUuid}
      photoUuid={conversation.photoUuid}
      photoBlurhash={conversation.photoBlurhash}
      matchPercentage={conversation.matchPercentage}
      lastMessage={conversation.lastMessage}
      lastMessageTimestamp={conversation.lastMessageTimestamp}
      isAvailableUser={conversation.isAvailableUser}
      isVerified={conversation.isVerified}
    />
  }
};

const renderItem = ({ item }: ListRenderItemInfo<InboxListItem>) =>
  typeof item === 'string'
    ? <RenderItem item={item} />
    : <InboxDivider label={item.label} />;

const keyExtractor = (item: InboxListItem) =>
  typeof item === 'string' ? item : item.dividerKey;

const InboxTab = () => {
  const { appTheme } = useAppTheme();

  const {
    conversations,
    numIntrosWithinFilters,
    sectionIndex,
    sortByIndex,
    showArchive,
    applySearchFilters,
    setSectionIndex,
    setSortByIndex,
    setApplySearchFilters,
    setShowArchive,
  } = useConversations();

  const stats = useInboxStats();

  const [isRefreshingInbox, setIsRefreshingInbox] = useState(false);

  const numUnreadIntros = stats?.numUnreadIntros ?? 0;
  const numUnreadChats  = stats?.numUnreadChats  ?? 0;

  const numIntros = stats?.numIntros ?? 0;

  const canApplySearchFilters =
    sectionIndex === 0 &&
    numIntros >= MIN_INTROS_TO_APPLY_SEARCH_FILTERS;

  const introsNumericalLabel = (
    numUnreadIntros ?
      ` (${numUnreadIntros})` :
      '');
  const chatsNumericalLabel = (
    numUnreadChats  ?
    ` (${numUnreadChats})` :
    '');

  const setSectionIndex_ = useCallback((value: number) => {
    setSectionIndex(value);
    inboxSection(value);
  }, []);

  const setSortByIndex_  = useCallback((value: number) => {
    setSortByIndex(value);
    inboxOrder(value);
  }, []);

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
    const value = !applySearchFilters;
    setApplySearchFilters(value);
    inboxApplySearchFilters(value ? 1 : 0);
  }, [applySearchFilters]);

  const onPressArchiveButton = useCallback(() => {
    setShowArchive(x => !x);
  }, []);

  useEffect(() => {
    (async () => {
      const _inboxOrder = await inboxOrder();
      const _inboxSection = await inboxSection();
      const _inboxApplySearchFilters = await inboxApplySearchFilters();

      setSectionIndex(_inboxSection);
      setSortByIndex(_inboxOrder);
      setApplySearchFilters(!!_inboxApplySearchFilters);
    })();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (consumeStaleInbox()) {
        setIsRefreshingInbox(true);
        refreshInbox().finally(() => setIsRefreshingInbox(false));
      }
    }, [])
  );

  const listData = useMemo<InboxListItem[] | null>(() => {
    if (conversations === null) {
      return null;
    }

    // Non-null exactly when the visible section is intros with search filters
    // applied, and marks where the sorted list's "outside" region begins.
    if (numIntrosWithinFilters === null) {
      return conversations;
    }

    const numWithin = numIntrosWithinFilters;
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
  }, [conversations, numIntrosWithinFilters]);

  const emptyText = (() => {
    if (!showArchive && sectionIndex === 0)
      return (
        'This is where you’ll see messages from people who’ve reached out ' +
        'to you first – Once you reply, they’ll move to your Chats\xa0💬'
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
    } else {
      if (sectionIndex === 0) {
        return 'Those are all the intros you have for now';
      } else {
        return 'No more chats to show';
      }
    }
  })();

  const {
    onLayout,
    onContentSizeChange,
    onScroll,
    showsVerticalScrollIndicator,
    observeListRef,
  } = useScrollbar('inbox');

  return (
    <View style={styles.safeAreaView}>
      <InboxTabNavBar
        showArchive={showArchive}
        applySearchFilters={applySearchFilters}
        isRefreshingInbox={isRefreshingInbox}
        showFilterButton={canApplySearchFilters}
        showFilterHint={
          !isFilterHintDismissed &&
          !showArchive &&
          canApplySearchFilters
        }
        onPressArchiveButton={onPressArchiveButton}
        onPressFilterButton={onPressFilterButton}
        onDismissFilterHint={dismissFilterHint}
      />
      {listData === null &&
        <View style={{height: '100%', justifyContent: 'center', alignItems: 'center'}}>
          <LogoActivityIndicator size="large" color={appTheme.brandColor} />
        </View>
      }
      {listData !== null &&
        <View style={styles.flatListContainer} onLayout={onLayout}>
          <Animated.FlatList<InboxListItem>
            ref={observeListRef}
            data={listData}
            ListHeaderComponent={<>{
              !showArchive && <>
                <ButtonGroup
                  buttons={[
                    'Intros' + introsNumericalLabel,
                    'Chats'  + chatsNumericalLabel
                  ]}
                  selectedIndex={sectionIndex}
                  onPress={setSectionIndex_}
                  containerStyle={{
                    marginTop: 5,
                    marginLeft: 20,
                    marginRight: 20,
                  }}
                />
                <ButtonGroup
                  buttons={['Best Matches First', 'Latest First']}
                  selectedIndex={sortByIndex}
                  onPress={setSortByIndex_}
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
            ListFooterComponent={
              listData.length > 0 ?
                <DefaultText style={styles.endText}>{endText}</DefaultText> :
                null
            }
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            onContentSizeChange={onContentSizeChange}
            onScroll={onScroll}
            showsVerticalScrollIndicator={showsVerticalScrollIndicator}
            contentContainerStyle={styles.flatList}
          />
        </View>
      }
    </View>
  );
};

const InboxTabNavBar = ({
  showArchive,
  applySearchFilters,
  isRefreshingInbox,
  showFilterButton,
  showFilterHint,
  onPressArchiveButton,
  onPressFilterButton,
  onDismissFilterHint,
}: {
  showArchive: boolean,
  applySearchFilters: boolean,
  isRefreshingInbox: boolean,
  showFilterButton: boolean,
  showFilterHint: boolean,
  onPressArchiveButton: () => void,
  onPressFilterButton: () => void,
  onDismissFilterHint: () => void,
}) => {
  const { appTheme } = useAppTheme();
  const [isOnline, setIsOnline] = useState(false);

  useLayoutEffect(() => {
    return listen<boolean>(
      'chat-is-online',
      (data) => setIsOnline(data ?? false),
      true,
    );
  }, []);

  return (
    <TopNavBar>
      <View>
        <DefaultText
          style={{
            fontWeight: '700',
            fontSize: 20,
          }}
        >
          {'Inbox' + (showArchive ? ' (Archive)' : '')}
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
      <View style={styles.navBarButtons}>
        {!showArchive && showFilterButton &&
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
            {showFilterHint &&
              <InboxFilterHint onDismiss={onDismissFilterHint} />
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
    </TopNavBar>
  );
};

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
  // Spacing lives here rather than as `gap` on navBarButtons because
  // reanimated's exiting animation positions the leaving filter button as if
  // the row had no gap, making it jump flush against this button.
  archiveButton: {
    marginLeft: 14,
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

export { InboxTab };
