import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  StyleSheet,
  View,
  ScrollView,
  Pressable,
} from 'react-native';
import Reanimated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { FlashList } from '@shopify/flash-list';
import { LogoActivityIndicator } from '../logo/logo-activity-indicator';
import * as _ from "lodash";
import { ModalButton } from '../button/modal';
import { listen, notify } from '../../events/events';
import { backgroundColors } from './background-colors';
import { DefaultTextInput } from '../default-text-input';
import { AutoResizingGif } from '../auto-resizing-gif';
import { KLIPY_API_KEY } from '../../env/env';
import { isMobile } from '../../util/util';
import { useAppTheme } from '../../app-theme/app-theme';
import { ModalBottomSheet } from './modal-bottom-sheet';

type GifPickedEvent = string;

type KlipyGif = {
  file: {
    hd: { gif: { url: string } },
    sm: { gif: { url: string } },
    xs: { gif: { url: string } },
  },
};

const KLIPY_SEARCH_URL =
  `https://api.klipy.com/api/v1/${KLIPY_API_KEY}/gifs/search`;
const NUM_COLS = 3;
const PER_PAGE = NUM_COLS * 8;
const MAX_PAGES = 4;

const fadeIn = FadeIn.duration(200);
const fadeOut = FadeOut.duration(200);

const indexToPriority = (row: number): 'low' | 'normal' | 'high' => {
  if (row < 5) {
    return 'high';
  } else if (row < 10) {
    return 'normal';
  } else {
    return 'low';
  }
};

// Helper to render a single gif item
const RenderGifItem = ({
  gifUrl,
  previewUrl,
  onPress,
  isSelected,
  priority,
}: {
  gifUrl: string,
  previewUrl: string,
  onPress: (url: string) => void
  isSelected: boolean
  priority: null | 'low' | 'normal' | 'high'
}) => {
  return (
    <View style={styles.gifItemContainer}>
      <Pressable onPress={() => onPress(gifUrl)}>
        <AutoResizingGif
          priority={priority}
          uri={previewUrl}
          activityIndicator="default"
          style={[
            styles.gifImage,
            isSelected ? styles.selectedGif : styles.unselectedGif,
          ]}
        />
      </Pressable>
    </View>
  );
};

const GifPickerModal: React.FC = () => {
  const { appTheme } = useAppTheme();
  const [isShowing, setIsShowing] = useState(false);
  const [selectedGif, setSelectedGif] = useState<null | string>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [gifResults, setGifResults] = useState<KlipyGif[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const paginationRef = useRef({
    fetchId: 0,
    query: '',
    page: 1,
    hasNext: false,
    isFetchingMore: false,
  });

  const cancel = useCallback(() => {
    setIsShowing(false);
  }, []);

  const pickGif = useCallback(() => {
    if (selectedGif) {
      notify<GifPickedEvent>('gif-picked', selectedGif);
      setIsShowing(false);
    }
  }, [selectedGif]);

  const onPressGif = useCallback((url: string) => {
    if (isMobile()) {
      notify<GifPickedEvent>('gif-picked', url);
      setIsShowing(false);
    } else {
      setSelectedGif(url);
    }
  }, []);

  const fetchGifPage = useCallback(async (
    query: string,
    page: number,
  ): Promise<{ gifs: KlipyGif[], hasNext: boolean }> => {
    try {
      const response = await fetch(
        `${KLIPY_SEARCH_URL}` +
          `?q=${encodeURIComponent(query)}` +
          `&page=${page}` +
          `&per_page=${PER_PAGE}`
      );
      const json = await response.json();
      return {
        gifs: json?.data?.data ?? [],
        hasNext: Boolean(json?.data?.has_next),
      };
    } catch (error) {
      console.error('Error fetching gifs:', error);
      return { gifs: [], hasNext: false };
    }
  }, []);

  // Fetch gifs from Klipy when a search query is provided
  const fetchGifs = useCallback(async (query: string) => {
    const pagination = paginationRef.current;
    pagination.fetchId += 1;
    pagination.query = query;
    pagination.page = 1;
    pagination.hasNext = false;
    const fetchId = pagination.fetchId;
    setLoading(true);
    const { gifs, hasNext } = await fetchGifPage(query, 1);
    if (fetchId !== pagination.fetchId) {
      return;
    }
    pagination.hasNext = hasNext;
    setGifResults(gifs);
    setLoading(false);
    setLoadingMore(false);
  }, [fetchGifPage]);

  const fetchMoreGifs = useCallback(async () => {
    const pagination = paginationRef.current;
    if (
      !pagination.hasNext ||
      pagination.isFetchingMore ||
      pagination.page >= MAX_PAGES
    ) {
      return;
    }
    pagination.isFetchingMore = true;
    const fetchId = pagination.fetchId;
    const nextPage = pagination.page + 1;
    setLoadingMore(true);
    const { gifs, hasNext } = await fetchGifPage(pagination.query, nextPage);
    pagination.isFetchingMore = false;
    if (fetchId !== pagination.fetchId) {
      return;
    }
    pagination.page = nextPage;
    pagination.hasNext = hasNext;
    setGifResults((existingGifs) => [...existingGifs, ...gifs]);
    setLoadingMore(false);
  }, [fetchGifPage]);

  const onScrollGrid = useCallback((
    event: NativeSyntheticEvent<NativeScrollEvent>
  ) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const distanceFromBottom =
      contentSize.height - contentOffset.y - layoutMeasurement.height;
    if (distanceFromBottom < layoutMeasurement.height * 2) {
      fetchMoreGifs();
    }
  }, [fetchMoreGifs]);

  const renderGifItem = useCallback((
    { item, index }: { item: KlipyGif, index: number }
  ) => (
    <View style={styles.flashListItem}>
      <RenderGifItem
        priority={indexToPriority(Math.floor(index / NUM_COLS))}
        gifUrl={item.file?.hd?.gif?.url}
        previewUrl={item.file?.xs?.gif?.url}
        isSelected={item.file?.hd?.gif?.url === selectedGif}
        onPress={onPressGif}
      />
    </View>
  ), [selectedGif, onPressGif]);

  const keyExtractor = useCallback(
    (item: KlipyGif, index: number) =>
      item.file?.hd?.gif?.url ?? String(index),
    [],
  );

  // Use lodash debounce to delay search requests
  const debouncedFetchGifs = useCallback(
    _.debounce((query: string) => {
      fetchGifs(query);
    }, 500),
    [fetchGifs]
  );

  useEffect(() => {
    if (!isShowing) {
      return;
    }
    debouncedFetchGifs(searchQuery);
  }, [isShowing, searchQuery, debouncedFetchGifs]);

  useEffect(() => {
    return listen('show-gif-picker', () => {
      setIsShowing(true);
      setSelectedGif(null);
      setSearchQuery('');
      setGifResults([]);
    });
  }, []);

  // Divide gifResults equally between three columns
  const columns = _.times<KlipyGif[]>(NUM_COLS, () => []);
  gifResults.forEach((item, index) => {
    columns[index % NUM_COLS].push(item);
  });

  const loadingMoreIndicator = loadingMore ? (
    <LogoActivityIndicator
      size="large"
      color="#70f"
      style={styles.loadingMoreIndicator}
    />
  ) : null;

  const webGrid = (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollViewContainer}
      onScroll={onScrollGrid}
      scrollEventThrottle={100}
    >
      <View style={styles.columnsContainer}>
        {columns.map((column, i) =>
          <View key={i} style={styles.column}>
            {column.map((item, j) =>
              <RenderGifItem
                key={j}
                priority={indexToPriority(j)}
                gifUrl={item.file?.hd?.gif?.url}
                previewUrl={
                  isMobile() ?
                    item.file?.xs?.gif?.url :
                    item.file?.sm?.gif?.url
                }
                isSelected={item.file?.hd?.gif?.url === selectedGif}
                onPress={onPressGif}
              />
            )}
          </View>
        )}
      </View>
      {loadingMoreIndicator}
    </ScrollView>
  );

  const nativeGrid = (
    <FlashList
      data={gifResults}
      numColumns={NUM_COLS}
      masonry
      renderItem={renderGifItem}
      keyExtractor={keyExtractor}
      onEndReached={fetchMoreGifs}
      onEndReachedThreshold={2}
      contentContainerStyle={styles.flashListContent}
      ListFooterComponent={loadingMoreIndicator}
      showsVerticalScrollIndicator={false}
    />
  );

  const gridList = Platform.OS === 'web' ? webGrid : nativeGrid;

  const grid = loading ? (
    <LogoActivityIndicator
      size="large"
      color="#70f"
      style={styles.loadingIndicator}
    />
  ) : gridList;

  if (isMobile()) {
    const searchInput = (
      <DefaultTextInput
        style={styles.sheetSearchInput}
        placeholder="Search KLIPY"
        value={searchQuery}
        onChangeText={setSearchQuery}
      />
    );

    const searchInputPlacement = Platform.OS === 'web'
      ? { footer: searchInput }
      : { header: searchInput };

    return (
      <ModalBottomSheet
        visible={isShowing}
        onRequestClose={cancel}
        {...searchInputPlacement}
      >
        <View style={styles.sheetGrid}>
          {grid}
        </View>
      </ModalBottomSheet>
    );
  }

  if (!isShowing) {
    return null;
  }

  return (
    <Reanimated.View
      style={styles.modal}
      entering={fadeIn}
      exiting={fadeOut}
    >
      <View
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          maxWidth: 600,
          height: '80%',
          backgroundColor: appTheme.primaryColor,
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        <View style={styles.gifGalleryContainer}>
          <DefaultTextInput
            style={styles.searchInput}
            placeholder="Search KLIPY"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus={true}
          />
          {grid}
        </View>
        <View style={styles.buttonContainer}>
          <ModalButton color="#999" onPress={cancel} title="Cancel" />
          <ModalButton color="#70f" onPress={pickGif} title="Send" />
        </View>
      </View>
    </Reanimated.View>
  );
};

const styles = StyleSheet.create({
  modal: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
    ...backgroundColors.dark,
  },
  buttonContainer: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    flexDirection: 'row',
    marginVertical: 10,
  },
  gifGalleryContainer: {
    width: '100%',
    gap: 10,
    flex: 1,
    padding: 10,
  },
  searchInput: {
    borderWidth: 0,
    marginLeft: 0,
    marginRight: 0,
  },
  sheetSearchInput: {
    borderWidth: 0,
    height: 40,
    marginTop: 10,
    marginLeft: 10,
    marginRight: 10,
    marginBottom: 8,
  },
  sheetGrid: {
    flex: 1,
    paddingHorizontal: 10,
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContainer: {
    gap: 10,
  },
  columnsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  column: {
    flex: 1,
    gap: 10,
  },
  gifItemContainer: {
    justifyContent: 'center',
  },
  gifImage: {
    borderRadius: 5,
    borderWidth: 6,
  },
  selectedGif: {
    borderColor: '#70f',
  },
  unselectedGif: {
    borderColor: 'transparent',
  },
  loadingIndicator: {
    marginTop: 20,
    alignSelf: 'center',
  },
  loadingMoreIndicator: {
    marginVertical: 10,
    alignSelf: 'center',
  },
  flashListContent: {
    paddingHorizontal: 5,
  },
  flashListItem: {
    padding: 5,
  },
});

export {
  GifPickerModal,
  GifPickedEvent,
};
