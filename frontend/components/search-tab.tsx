import {
  LayoutChangeEvent,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
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
import { DefaultFlatList, FetchPageError } from './default-flat-list';
import { japi } from '../api/api';
import { TopNavBarButton } from './top-nav-bar-button';
import { isMobile } from '../util/util';
import * as _ from 'lodash';
import { useJoinedClubs, useSearchClub } from '../club/club';
import { ClubRow } from './clubs/club-row';
import { OldClubRow } from './clubs/old-club-row';
import { clubsRedesign } from '../util/trials';
import { searchQueue } from '../api/queue';
import { useScrollbar } from './navigation/scroll-bar-hooks';
import { useIsWebLoggedOut, useSignedInUser } from '../events/signed-in-user';
import { encodedAnonymousAnswers } from '../events/anonymous-answers';
import { getPublicSearchFilters } from '../events/public-search-filters';
import { genders } from '../data/option-groups';
import {
  areSearchResultsRecent,
  consumeStaleSearchResults,
  recordSearchResultsFetch,
} from '../events/stale-search-results';
import {
  listenSearchRequests,
  requestSearch,
  whileSearching,
} from '../events/search-requests';
import {
  flushSearchFilterWrites,
  getSearchFilters,
  recordSearchedFilters,
} from '../events/search-filters';
import { SearchFiltersHint } from './hints/search-filters-hint';
import { seenSearchFiltersHint } from '../kv-storage/seen-hints/seen-search-filters-hint';
import { useHasRightPane } from './navigation/web-layout';

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
});

const minCardWidth = 125;

const scrollIndicatorInsets = {
  top: 50,
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

const publicSearchFilterParams = (): string => {
  const { gender, age } = getPublicSearchFilters();

  return [
    gender && gender.length < genders.length &&
      `&gender=${encodeURIComponent(JSON.stringify(gender))}`,
    typeof age?.min_age === 'number' && `&min_age=${age.min_age}`,
    typeof age?.max_age === 'number' && `&max_age=${age.max_age}`,
  ].filter(Boolean).join('');
};

const fetchPageWithoutQueue = async (
  club: string | null,
  pageNumber: number,
  isPublic: boolean,
): Promise<PageItem[] | FetchPageError | null> => {
  const resultsPerPage = 50;
  const offset = resultsPerPage * (pageNumber - 1);

  // Logged-out web users have no profile to rank against, so the public search
  // is ranked by the answers they've given in the Q&A tab (when they've given
  // any). Signed-in users are ranked server-side from their saved answers.
  const answers = isPublic ? encodedAnonymousAnswers() : null;
  const answersParam = answers ? `&answers=${answers}` : '';
  const filterParams = isPublic ? publicSearchFilterParams() : '';

  const response = await japi<PageItem[]>(
    'get',
    (isPublic ? '/public-search' : '/search') +
    `?n=${resultsPerPage}` +
    `&o=${offset}` +
    `&club=${encodeURIComponent(club === null ? '\0' : club)}` +
    answersParam +
    filterParams
  );

  if (pageNumber === 1) {
    recordSearchResultsFetch(response.ok);
  }

  if (response.status === 429) {
    return {
      errorText:
        "You’re searching too quickly. Wait a minute or two, then try again.",
    };
  }

  return response.ok && response.json ? response.json : null;
};

const fetchPage = (
  club: string | null,
  isPublic: boolean,
) => async (
  pageNumber: number
): Promise<PageItem[] | FetchPageError | null> => {
  const filters = getSearchFilters();

  await flushSearchFilterWrites();

  const page = await searchQueue.addTask(
    async () => fetchPageWithoutQueue(club, pageNumber, isPublic));

  if (pageNumber === 1 && Array.isArray(page)) {
    recordSearchedFilters(filters);
  }

  return page;
};

const SearchScreen_ = ({navigation}: SearchScreenProps) => {
  const isPublic = useIsWebLoggedOut();
  const hasFilterPanel = useHasRightPane();

  const listRef = useRef<{ refresh: () => Promise<void> } | null>(null);

  const {
    onLayout,
    onContentSizeChange,
    onScroll,
    showsVerticalScrollIndicator,
    observeListRef,
  } = useScrollbar('search');

  const selectedClub = useSearchClub();
  const [signedInUser] = useSignedInUser();
  const isRedesign = clubsRedesign(signedInUser?.personId);
  const hasJoinedClubs = (useJoinedClubs()?.length ?? 0) > 0;
  const hasClubRow = isRedesign ? !isPublic : hasJoinedClubs;

  const [isFiltersHintDismissed, setIsFiltersHintDismissed] = useState(true);

  const [width, setWidth] = useState<number | null>(null);

  const onLayoutScreen = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    if (nativeEvent.layout.width > 0) {
      setWidth(nativeEvent.layout.width);
    }
  }, []);

  const numColumns = isMobile() || width === null
    ? 2
    : _.clamp(Math.floor(width / minCardWidth), 2, 4);

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

  const onPressRefresh = useCallback(async () => {
    await listRef.current?.refresh();
  }, []);

  // Changing a search filter or answering a Q&A question re-ranks these
  // results, so refetch when the tab regains focus if they've gone stale since
  // we last fetched.
  useFocusEffect(
    useCallback(() => {
      if (consumeStaleSearchResults()) {
        whileSearching(onPressRefresh);
      }
    }, [onPressRefresh])
  );

  useEffect(() => {
    return listenSearchRequests(async () => {
      if (!consumeStaleSearchResults() && areSearchResultsRecent()) return;
      await onPressRefresh();
    });
  }, [onPressRefresh]);

  const onPressOptions = useCallback(() => {
    dismissFiltersHint();
    navigation.navigate('Search Filter Screen', {
      screen: 'Search Filter Tab',
    });
  }, [selectedClub, dismissFiltersHint]);

  useEffect(() => {
    whileSearching(onPressRefresh);
  }, [selectedClub]);

  const fetchSearchPage = useMemo(
    () => fetchPage(selectedClub, isPublic),
    [selectedClub, isPublic]);

  const listHeaderComponent = useMemo(
    () => !hasClubRow ? null : isRedesign ? <ClubRow /> : <OldClubRow />,
    [hasClubRow, isRedesign]);

  const cardWidth = (width ?? 0) / numColumns;

  const renderItem = useCallback(
    ({item}: ListRenderItemInfo<PageItem>) =>
      <ProfileCardMemo
        item={item}
        numColumns={numColumns}
        cardWidth={cardWidth}
      />,
    [numColumns, cardWidth]);

  const stickyHeaderIndices = useMemo(
    () => hasClubRow ? [0] : [], [hasClubRow]);

  return (
    <View style={styles.safeAreaView} onLayout={onLayoutScreen}>
      {!hasFilterPanel &&
        <DuoliciousTopNavBar>
          {Platform.OS === 'web' &&
            <TopNavBarButton
              onPress={requestSearch}
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
            }}
          >
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
      }
      {width !== null && <DefaultFlatList
        key={
          // This is needed to trigger a re-render when the sticky header
          // indicies change. Without this, the header is blank on Android.
          String(hasClubRow)
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
          "See more matches by adjusting your search filters or clubs"
        }
        fetchPage={fetchSearchPage}
        dataKey={JSON.stringify([selectedClub, isPublic])}
        hideListHeaderComponentWhenEmpty={!hasClubRow}
        hideListHeaderComponentWhenLoading={!hasClubRow}
        numColumns={numColumns}
        contentContainerStyle={styles.listContainerStyle}
        ListHeaderComponent={listHeaderComponent}
        renderItem={renderItem}
        scrollIndicatorInsets={scrollIndicatorInsets}
        onLayout={onLayout}
        onContentSizeChange={onContentSizeChange}
        onScroll={onScroll}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        stickyHeaderHiddenOnScroll={hasClubRow && isMobile()}
        stickyHeaderIndices={stickyHeaderIndices}
        columnWrapperStyle={styles.listColumnWraperStyle}
      />}
    </View>
  );
};

export {
  SearchTab,
  PageItem,
};
