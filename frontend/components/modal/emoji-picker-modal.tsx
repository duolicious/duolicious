import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { listen } from '../../events/events';
import {
  AnchorMeasurement,
  AnchoredOverlay,
  aboveAnchorStyle,
  useWindowOverlayDimensions,
} from '../anchored-overlay';
import { DefaultTextInput } from '../default-text-input';
import { EmojiGrid } from '../emoji-picker';
import { ModalBottomSheet } from './modal-bottom-sheet';
import {
  sendReactionAndNotify,
  useReaction,
} from '../../chat/application-layer/hooks/reaction';
import { isMobile } from '../../util/util';
import { useAppTheme } from '../../app-theme/app-theme';

type ShowEmojiPickerEvent = {
  mamId: string
  // Present only on desktop, where the picker is anchored to the message
  anchor?: AnchorMeasurement
};

const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 400;

const SearchInput = ({
  query,
  onChangeQuery,
  autoFocus,
}: {
  query: string
  onChangeQuery: (query: string) => void
  autoFocus?: boolean
}) => (
  <DefaultTextInput
    style={styles.searchInput}
    placeholder="Search emojis"
    value={query}
    onChangeText={onChangeQuery}
    autoFocus={autoFocus}
  />
);

const EmojiPickerModal: React.FC = () => {
  const { appTheme } = useAppTheme();
  const windowDimensions = useWindowOverlayDimensions();
  const [isShowing, setIsShowing] = useState(false);
  const [event, setEvent] = useState<ShowEmojiPickerEvent | null>(null);
  const [query, setQuery] = useState('');

  const reaction = useReaction(event?.mamId);

  const close = useCallback(() => setIsShowing(false), []);

  const onPick = useCallback((emoji: string) => {
    if (event) {
      const next = reaction?.emoji === emoji ? '' : emoji;
      sendReactionAndNotify(event.mamId, next);
    }
    setIsShowing(false);
  }, [event, reaction?.emoji]);

  useEffect(() => {
    return listen<ShowEmojiPickerEvent>('show-emoji-picker', (data) => {
      if (!data) {
        return;
      }

      setEvent(data);
      setQuery('');
      setIsShowing(true);
    });
  }, []);

  // `event` is kept while `isShowing` is false so the sheet's contents stay
  // mounted through its exit animation
  if (isMobile() && !event) {
    return null;
  }

  if (isMobile()) {
    const searchInput = <SearchInput query={query} onChangeQuery={setQuery} />;

    // On mobile web the on-screen keyboard overlays the sheet's bottom;
    // anchoring the search input there makes the browser scroll it into view,
    // keeping the grid above it visible
    const searchInputPlacement = Platform.OS === 'web'
      ? { footer: searchInput }
      : { header: searchInput };

    return (
      <ModalBottomSheet
        visible={isShowing}
        onRequestClose={close}
        {...searchInputPlacement}
      >
        <EmojiGrid
          query={query}
          selected={reaction?.emoji}
          onPick={onPick}
        />
      </ModalBottomSheet>
    );
  } else {
    return (
      <AnchoredOverlay
        visible={isShowing}
        modal
        onRequestClose={close}
      >
        <Pressable
          onPressIn={close}
          style={StyleSheet.absoluteFillObject}
        />
        <Animated.View
          entering={FadeIn.duration(100)}
          style={[
            aboveAnchorStyle(event?.anchor, windowDimensions, {
              estimatedWidth: PANEL_WIDTH,
              estimatedHeight: PANEL_HEIGHT,
            }),
            {
              width: PANEL_WIDTH,
              height: PANEL_HEIGHT,
              backgroundColor: appTheme.primaryColor,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: appTheme.reactionBarBorderColor,
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 8,
              overflow: 'hidden',
            },
          ]}
        >
          <SearchInput query={query} onChangeQuery={setQuery} autoFocus />
          <View style={styles.panelGrid}>
            <EmojiGrid
              query={query}
              selected={reaction?.emoji}
              onPick={onPick}
            />
          </View>
        </Animated.View>
      </AnchoredOverlay>
    )
  }
};

const styles = StyleSheet.create({
  searchInput: {
    borderWidth: 0,
    height: 40,
    marginTop: 10,
    marginLeft: 10,
    marginRight: 10,
    marginBottom: 8,
  },
  panelGrid: {
    flex: 1,
  },
});

export {
  EmojiPickerModal,
  ShowEmojiPickerEvent,
};
