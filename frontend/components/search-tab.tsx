import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Dispatch,
  SetStateAction,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  NativeStackScreenProps,
  createNativeStackNavigator,
} from '@react-navigation/native-stack';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { CompositeScreenProps, useFocusEffect } from '@react-navigation/native';
import type { ListRenderItemInfo } from 'react-native';
import type { HomeParamList, SearchParamList } from '../navigation/linking';
import { ProfileCard }  from './profile-card';
import { DuoliciousTopNavBar } from './top-nav-bar';
import { SearchFilterScreen } from './search-filter-screen';
import { DefaultText } from './default-text';
import { DefaultFlatList } from './default-flat-list';
import { japi } from '../api/api';
import { TopNavBarButton } from './top-nav-bar-button';
import { LinearGradient } from 'expo-linear-gradient';
import { isMobile } from '../util/util';
import Ionicons from '@expo/vector-icons/Ionicons';
import { ClubItem, sortClubs } from '../club/club';
import { listen, lastEvent } from '../events/events';
import { searchQueue } from '../api/queue';
import { useScrollbar } from './navigation/scroll-bar-hooks';
import { onPressInvite } from '../components/invite';
import { useAppTheme } from '../app-theme/app-theme';
import { useIsWebLoggedOut } from '../events/signed-in-user';
import { anonymousAnswers } from '../events/anonymous-answers';
import { consumeStaleSearchResults } from '../events/stale-search-results';
import { flushSearchFilterWrites } from '../events/search-filters';
import { SearchFiltersHint } from './hints/search-filters-hint';
import { seenSearchFiltersHint } from '../kv-storage/seen-hints/seen-search-filters-hint';

type SearchScreenProps = CompositeScreenProps<
  NativeStackScreenProps<SearchParamList, 'Search Screen'>,
  BottomTabScreenProps<HomeParamList>
>;

const styles = StyleSheet.create({
  safeAreaView: {
    flex: 1,
  },
  listContainerStyle: {
    paddingTop: 0,
    rowGap: 5,
  },
  listColumnWraperStyle: {
    gap: 5,
    paddingHorizontal: 5,
  },
  clubsScrollViewContainer: {
    alignItems: 'center',
  },
  clubsContentContainerContainer: {
    borderRadius: 5,
    overflow: 'hidden',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 600,
  },
  clubTitle: {
    fontSize: 18,
    fontWeight: '900',
    paddingLeft: 5,
    paddingRight: 10,
    paddingVertical: 5,
  },
  clubContainerEveryone: {
    marginHorizontal: 30,
    borderRadius: 5,
    overflow: 'hidden',
  },
  clubContainer: {
    borderRadius: 5,
    overflow: 'hidden',
  },
});

const scrollIndicatorInsets = {
  top: 50,
};

const getStateFromClubItems = (cs: ClubItem[] | undefined) => {
  const clubs = cs ?? [];

  const hasClubs = clubs
    .length > 0;
  const selectedClub = clubs
    .find((c) => c.search_preference === true)
    ?.name;

  return { hasClubs, selectedClub };
};

const Stack = createNativeStackNavigator();

const SearchTab = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        presentation: 'card'
      }}
    >
      <Stack.Screen
        name="Search Screen"
        component={SearchScreen_}
        options={{ title: 'Search' }}
      />
      <Stack.Screen name="Search Filter Screen" component={SearchFilterScreen} />
    </Stack.Navigator>
  );
};

const ProfileCardMemo = memo(ProfileCard);

type PageItem = {
  prospect_person_id: number
  prospect_uuid: string
  url_slug: string | null
  profile_photo_uuid: string
  profile_photo_blurhash: string
  name: string
  age: number
  match_percentage: number
  person_messaged_prospect: boolean
  prospect_messaged_person: boolean
  verified: boolean
  verification_required_to_view: string | null
};

const fetchPageWithoutQueue = async (
  club: string | null,
  pageNumber: number,
  isPublic: boolean,
): Promise<PageItem[] | null> => {
  const resultsPerPage = 10;
  const offset = resultsPerPage * (pageNumber - 1);

  // Logged-out web users have no profile to rank against, so the public search
  // is ranked by the answers they've given in the Q&A tab (when they've given
  // any). Signed-in users are ranked server-side from their saved answers.
  const answersParam =
    isPublic && anonymousAnswers.length
      ? `&answers=${encodeURIComponent(JSON.stringify(anonymousAnswers))}`
      : '';

  const response = await japi<PageItem[]>(
    'get',
    (isPublic ? '/public-search' : '/search') +
    `?n=${resultsPerPage}` +
    `&o=${offset}` +
    `&club=${encodeURIComponent(club === null ? '\0' : club)}` +
    answersParam
  );

  return response.ok ? response.json : null;
};

const fetchPage = (
  club: string | null,
  isPublic: boolean,
) => async (
  pageNumber: number
): Promise<PageItem[] | null> => {
  return searchQueue.addTask(
    async () => fetchPageWithoutQueue(club, pageNumber, isPublic));
};

type ClubSelectorProps = {
  selectedClub: string | null;
  onChangeSelectedClub: (s: string | null) => void;
};

const LeftContinuation = ({scrollLeft}: {scrollLeft: () => void}) => {
  const { appTheme } = useAppTheme();

  if (isMobile()) {
    return (
      <LinearGradient
        start={{x: 0, y: 0 }}
        end={{x: 1, y: 0 }}
        colors={['#00000044', '#00000000']}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,

          height: '100%',
          width: 10,

          zIndex: 999,
        }}
      />
    );
  } else {
    return (
      <Pressable
        onPress={scrollLeft}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,

          height: '100%',
          width: 40,

          zIndex: 999,
        }}
      >
        <LinearGradient
          start={{x: 0, y: 0 }}
          end={{x: 1, y: 0 }}
          locations={[0.0, 0.8, 1.0]}
          colors={[
            `${appTheme.primaryColor}ff`,
            `${appTheme.primaryColor}e5`,
            `${appTheme.primaryColor}00`,
          ]}
          style={{
            height: '100%',
            width: '100%',
            justifyContent: 'center',
            alignItems: 'flex-start',
          }}
        >
          <Ionicons
            style={{
              fontSize: 26,
              color: appTheme.secondaryColor,
            }}
            name="chevron-back"
          />
        </LinearGradient>
      </Pressable>
    );
  }
};

const RightContinuation = ({scrollRight}: {scrollRight: () => void}) => {
  const { appTheme } = useAppTheme();

  if (isMobile()) {
    return (
      <LinearGradient
        start={{x: 0, y: 0 }}
        end={{x: 1, y: 0 }}
        colors={['#00000000', '#00000044']}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,

          height: '100%',
          width: 10,

          zIndex: 999,
        }}
      />
    );
  } else {
    return (
      <Pressable
        onPress={scrollRight}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,

          height: '100%',
          width: 40,

          zIndex: 999,
        }}
      >
        <LinearGradient
          start={{x: 0, y: 0 }}
          end={{x: 1, y: 0 }}
          locations={[0.0, 0.2, 1.0]}
          colors={[
            `${appTheme.primaryColor}00`,
            `${appTheme.primaryColor}e5`,
            `${appTheme.primaryColor}ff`,
          ]}
          style={{
            height: '100%',
            width: '100%',
            justifyContent: 'center',
            alignItems: 'flex-end',
          }}
        >
          <Ionicons
            style={{
              fontSize: 26,
              color: appTheme.secondaryColor,
            }}
            name="chevron-forward"
          />
        </LinearGradient>
      </Pressable>
    );
  }
};

const ClubSelector = (props: ClubSelectorProps) => {
  const { appTheme } = useAppTheme();

  const scrollJumpSize = 150;

  const scrollViewRef = useRef<ScrollView>(null);
  const scrollXRef = useRef(0);

  const hasJumpedToClubRef = useRef(false);

  const [isTop, setIsTop] = useState(true);
  const [isBottom, setIsBottom] = useState(true);
  const [contentWidth, setContentWidth] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [clubs, setClubs] = useState<ClubItem[]>(
    sortClubs(lastEvent('updated-clubs')));


  const checkIsTop = useCallback((nativeEvent: NativeScrollEvent) => {
    const isCloseToTop = nativeEvent.contentOffset.x <= 10;

    setIsTop(isCloseToTop);
  }, [setIsTop]);

  const checkIsBottom = useCallback((nativeEvent: NativeScrollEvent) => {
    const isCloseToBottom = (
      nativeEvent.layoutMeasurement.width +
      nativeEvent.contentOffset.x) >= nativeEvent.contentSize.width - 10;

    setIsBottom(isCloseToBottom);
  }, [setIsBottom]);

  const onScroll = useCallback(({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollXRef.current = nativeEvent.contentOffset.x;

    checkIsTop(nativeEvent);
    checkIsBottom(nativeEvent);
  }, [checkIsTop, checkIsBottom]);

  const onContentSizeChange = useCallback((width: number) =>
    setContentWidth(width), []);

  const onScrollViewLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) =>
    setContainerWidth(nativeEvent.layout.width), []);

  const onSelectedClubLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    (async () => {
      if (!scrollViewRef.current) {
        return;
      }

      if (hasJumpedToClubRef.current) {
        return;
      }

      scrollViewRef.current.scrollTo({
        x: nativeEvent.layout.x - scrollJumpSize,
        animated: false,
      });

      hasJumpedToClubRef.current = true;
    })();
  }, []);

  const scrollLeft = useCallback(() => {
    if (!scrollViewRef.current) {
      return;
    }
    scrollViewRef.current.scrollTo({
      x: scrollXRef.current - scrollJumpSize,
      animated: true,
    });
  }, []);

  const scrollRight = useCallback(() => {
    if (!scrollViewRef.current) {
      return;
    }
    scrollViewRef.current.scrollTo({
      x: scrollXRef.current + scrollJumpSize,
      animated: true,
    });
  }, []);

  useEffect(() => {
    if (containerWidth > 0 && contentWidth > 0) {
      setIsBottom(containerWidth >= contentWidth);
    }
  }, [containerWidth, contentWidth]);

  useEffect(() => {
    return listen(
      'updated-clubs',
      (maybeCs: ClubItem[] | undefined) => {
        hasJumpedToClubRef.current = false;

        const sortedCs = sortClubs(maybeCs);
        setClubs(sortedCs);
      }
    );
  }, []);

  useEffect(() => {
    if (clubs && clubs.every((club) => club.name !== props.selectedClub)) {
      hasJumpedToClubRef.current = false;

      props.onChangeSelectedClub(null);
    }
  }, [props.selectedClub, JSON.stringify(clubs)]);

  const dynamicStyles = StyleSheet.create({
    selectedClubText: {
      fontSize: 16,
      fontFamily: 'Trueno',
      paddingHorizontal: 10,
      paddingVertical: 5,
      color: appTheme.primaryColor,
      backgroundColor: appTheme.secondaryColor,
    },
    unselectedClubText: {
      fontSize: 16,
      fontFamily: 'Trueno',
      paddingHorizontal: 10,
      paddingVertical: 5,
      color: appTheme.secondaryColor,
    },
  });

  if (!clubs || !clubs.length) {
    return null;
  }

  return (
    <View
      style={{
        width: '100%',
        alignItems: 'stretch',
        alignSelf: 'center',
        paddingTop: 10,
        paddingBottom: 5,
        paddingHorizontal: 5,
        overflow: 'hidden',
        zIndex: 9999,
        opacity: 0.9,
        backgroundColor: appTheme.primaryColor,
      }}
    >
      <View style={styles.clubsContentContainerContainer}>
        <ScrollView
          ref={scrollViewRef}
          horizontal={true}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.clubsScrollViewContainer}
          onScroll={onScroll}
          onContentSizeChange={onContentSizeChange}
          onLayout={onScrollViewLayout}
        >
          <DefaultText style={styles.clubTitle}>
            CLUBS
          </DefaultText>

          <Pressable
            style={styles.clubContainerEveryone}
            onPress={() => props.onChangeSelectedClub(null)}
          >
            <DefaultText
              style={
                props.selectedClub === null ?
                  dynamicStyles.selectedClubText :
                  dynamicStyles.unselectedClubText
              }
            >
              Everyone
            </DefaultText>
          </Pressable>

          {clubs.map((club) =>
            <Pressable
              style={styles.clubContainer}
              key={club.name}
              onPress={() => props.onChangeSelectedClub(club.name)}
              onLayout={
                props.selectedClub === club.name && !hasJumpedToClubRef.current ?
                  onSelectedClubLayout :
                  undefined
              }
            >
              <DefaultText
                style={
                  props.selectedClub === club.name ?
                    dynamicStyles.selectedClubText :
                    dynamicStyles.unselectedClubText
                }
              >
                {club.name}
              </DefaultText>
            </Pressable>
          )}
        </ScrollView>

        {!isTop && <LeftContinuation scrollLeft={scrollLeft} />}
        {!isBottom && <RightContinuation scrollRight={scrollRight} />}
      </View>
    </View>
  );
};

const ListHeaderComponent = ({
  hasClubs,
  selectedClub,
  setSelectedClub,
}: {
  hasClubs: boolean,
  selectedClub: string | null,
  setSelectedClub: Dispatch<SetStateAction<string | null>>,
}) => {
  if (hasClubs) {
    return <ClubSelector
      selectedClub={selectedClub}
      onChangeSelectedClub={setSelectedClub}
    />;
  }

  return null;
};

const SearchScreen_ = ({navigation}: SearchScreenProps) => {
  const isPublic = useIsWebLoggedOut();

  const {
    hasClubs: initialHasClubs,
    selectedClub: initialSelectedClub,
  } = getStateFromClubItems(lastEvent<ClubItem[]>('updated-clubs'));

  const listRef = useRef<{ refresh: () => void } | null>(null);

  const {
    onLayout,
    onContentSizeChange,
    onScroll,
    showsVerticalScrollIndicator,
    observeListRef,
  } = useScrollbar('search');

  const [
    hasClubs,
    setHasClubs,
  ] = useState<boolean>(initialHasClubs);

  const [
    selectedClub,
    setSelectedClub,
  ] = useState<string | null>(initialSelectedClub ?? null);

  const [isFiltersHintDismissed, setIsFiltersHintDismissed] = useState(true);

  useEffect(() => {
    (async () => {
      if (!(await seenSearchFiltersHint())) {
        setIsFiltersHintDismissed(false);
      }
    })();
  }, []);

  const dismissFiltersHint = useCallback(() => {
    setIsFiltersHintDismissed(true);
    seenSearchFiltersHint(true);
  }, []);

  const onPressRefresh = useCallback(() => {
    const refresh = listRef?.current?.refresh;
    refresh && refresh();
  }, []);

  // Changing a search filter or answering a Q&A question re-ranks these
  // results, so refetch when the tab regains focus if they've gone stale since
  // we last fetched.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        await flushSearchFilterWrites();
        if (active && consumeStaleSearchResults()) {
          onPressRefresh();
        }
      })();
      return () => { active = false; };
    }, [onPressRefresh])
  );

  const onPressOptions = useCallback(() => {
    dismissFiltersHint();
    navigation.navigate('Search Filter Screen', {
      screen: 'Search Filter Tab',
    });
  }, [selectedClub, dismissFiltersHint]);

  useEffect(() => {
    const refresh = listRef?.current?.refresh;
    refresh && refresh();
  }, [selectedClub]);

  useEffect(() => {
    return listen(
      'updated-clubs',
      (cs: ClubItem[] | undefined) => {
        const { hasClubs, selectedClub } = getStateFromClubItems(cs);

        if (hasClubs !== undefined) {
          setHasClubs(hasClubs);
        }

        if (selectedClub !== undefined) {
          setSelectedClub(selectedClub);
        }
      }
    );
  }, []);

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
        <View
          style={{
            position: 'absolute',
            top: 0,
            height: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            right: 10,
            gap: 14,
          }}
        >
          {selectedClub &&
            <TopNavBarButton
              onPress={onPressInvite(selectedClub)}
              iconName="person-add-outline"
              position={null}
              secondary={true}
              label="Invite"
            />
          }
          <View>
            <TopNavBarButton
              onPress={onPressOptions}
              iconName="options-outline"
              position={null}
              secondary={false}
              label="Filters"
            />
            {!isFiltersHintDismissed && !isPublic &&
              <SearchFiltersHint onDismiss={dismissFiltersHint} />
            }
          </View>
        </View>
      </DuoliciousTopNavBar>
      <DefaultFlatList
        key={
          // This is needed to trigger a re-render when the sticky header
          // indicies change. Without this, the header is blank on Android.
          String(hasClubs)
        }
        ref={listRef}
        innerRef={observeListRef}
        emptyText={
          "No matches found. Try adjusting your search filters to include " +
          "more people."
        }
        errorText={
          "Something went wrong while fetching search results"
        }
        endText={
          "No more matches to show"
        }
        fetchPage={fetchPage(selectedClub, isPublic)}
        dataKey={JSON.stringify([selectedClub, isPublic])}
        hideListHeaderComponentWhenEmpty={!hasClubs}
        hideListHeaderComponentWhenLoading={!hasClubs}
        numColumns={2}
        contentContainerStyle={styles.listContainerStyle}
        ListHeaderComponent={
          <ListHeaderComponent
            hasClubs={hasClubs}
            selectedClub={selectedClub}
            setSelectedClub={setSelectedClub}
          />
        }
        renderItem={({item}: ListRenderItemInfo<PageItem>) => <ProfileCardMemo item={item} />}
        scrollIndicatorInsets={scrollIndicatorInsets}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        onScroll={onScroll}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        stickyHeaderHiddenOnScroll={hasClubs}
        stickyHeaderIndices={hasClubs ? [0] : []}
        columnWrapperStyle={styles.listColumnWraperStyle}
      />
    </View>
  );
};

export {
  SearchTab,
  PageItem,
};
