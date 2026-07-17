import { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  StyleSheet,
  View,
  ScrollView,
  Pressable,
} from 'react-native';
import Reanimated, { FadeIn, FadeOut } from 'react-native-reanimated';
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

  // Fetch gifs from Klipy when a search query is provided
  const fetchGifs = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const response = await fetch(
        `${KLIPY_SEARCH_URL}` +
          `?q=${encodeURIComponent(query)}` +
          `&page=1` +
          `&per_page=${NUM_COLS * 16}`
      );
      const json = await response.json();
      setGifResults(json?.data?.data || []);
    } catch (error) {
      console.error('Error fetching gifs:', error);
    }
    setLoading(false);
  }, []);

  // Use lodash debounce to delay search requests
  const debouncedFetchGifs = useCallback(
    _.debounce((query: string) => {
      fetchGifs(query);
    }, 500),
    [fetchGifs]
  );

  useEffect(() => {
    debouncedFetchGifs(searchQuery);
  }, [searchQuery, debouncedFetchGifs]);

  useEffect(() => {
    return listen('show-gif-picker', () => {
      setIsShowing(true);
      setSelectedGif(null);
      setSearchQuery('');
      setGifResults([]);
      debouncedFetchGifs("");
    });
  }, [debouncedFetchGifs]);

  // Divide gifResults equally between three columns
  const columns = _.times<KlipyGif[]>(NUM_COLS, () => []);
  gifResults.forEach((item, index) => {
    columns[index % NUM_COLS].push(item);
  });

  const grid = loading ? (
    <LogoActivityIndicator
      size="large"
      color="#70f"
      style={styles.loadingIndicator}
    />
  ) : (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={styles.scrollViewContainer}
    >
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
    </ScrollView>
  );

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
});

export {
  GifPickerModal,
  GifPickedEvent,
};
