import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Pressable } from '../pressable';
import { useNavigation } from '@react-navigation/native';
import { useAppTheme } from '../../app-theme/app-theme';
import { isMobile } from '../../util/util';
import {
  OpenClubCard,
  backClubCard,
  closeClubCard,
  closeClubs,
  openClubCard,
  useClubsSheet,
  useOpenClubCard,
} from '../../club/club';
import Animated, { FadeIn, FadeOut, runOnJS } from 'react-native-reanimated';
import { ModalBottomSheet } from '../modal/modal-bottom-sheet';
import { ClubsPanel } from './clubs-panel';
import { ClubCardBody, ClubCardCache, ClubCardTitle } from './club-card';
import { placePopover } from './place-popover';
import { useLatest } from '../../util/use-latest';

const POPOVER_WIDTH = 360;
const EDGE = 8;
const FADE_DURATION = 150;

const clubCardChain = (card: OpenClubCard): OpenClubCard[] =>
  card.previous ? [...clubCardChain(card.previous), card] : [card];

const Popover = ({
  visible,
  onRequestClose,
  onOpened,
  onClosed,
  left,
  top,
  height,
  maxHeight,
  children,
}: {
  visible: boolean,
  onRequestClose: () => void,
  onOpened?: () => void,
  onClosed?: () => void,
  left: number,
  top: number,
  height?: number,
  maxHeight?: number,
  children: ReactNode,
}) => {
  const { appTheme } = useAppTheme();
  const { width, height: windowHeight } = useWindowDimensions();

  return (
    visible &&
    <Animated.View
      entering={FadeIn.duration(FADE_DURATION).withCallback((finished) => {
        'worklet';
        if (finished && onOpened) {
          runOnJS(onOpened)();
        }
      })}
      exiting={FadeOut.duration(FADE_DURATION).withCallback((finished) => {
        'worklet';
        if (finished && onClosed) {
          runOnJS(onClosed)();
        }
      })}
      style={StyleSheet.absoluteFill}
    >
      <Pressable onPress={onRequestClose} style={StyleSheet.absoluteFill} />
      <View
        style={{
          position: 'absolute',
          left: Math.max(EDGE, Math.min(left, width - POPOVER_WIDTH - EDGE)),
          top: Math.max(EDGE, Math.min(top, windowHeight - (height ?? 0) - EDGE)),
          height,
          maxHeight,
          width: POPOVER_WIDTH,
          paddingTop: 16,
          backgroundColor: appTheme.primaryColor,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: appTheme.reactionBarBorderColor,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </Animated.View>
  );
};

const ClubsSheetHost = () => {
  const { height } = useWindowDimensions();
  const sheet = useClubsSheet();
  const shown = useLatest(sheet);

  if (shown === null) {
    return null;
  }

  if (isMobile()) {
    return (
      <ModalBottomSheet
        visible={sheet !== null}
        onRequestClose={closeClubs}
        heightFraction={1}
        top={shown.y + shown.height}
      >
        <ClubsPanel />
      </ModalBottomSheet>
    );
  }

  const top = shown.y + shown.height + 6;

  return (
    <Popover
      visible={sheet !== null}
      onRequestClose={closeClubs}
      left={shown.x + 10}
      top={top}
      maxHeight={height - top - 2 * EDGE}
    >
      <ClubsPanel />
    </Popover>
  );
};

const ClubCardHost = () => {
  const { width, height } = useWindowDimensions();
  const card = useOpenClubCard();
  const shown = useLatest(card);
  const cards = shown ? clubCardChain(shown) : [];
  const cache = useMemo((): ClubCardCache => new Map(), [cards[0]]);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isOpened, setIsOpened] = useState(false);
  const onOpened = useCallback(() => setIsOpened(true), []);

  if (shown === null) {
    return null;
  }

  const onClosed = () => setIsOpened(false);
  const onBack = shown.previous && backClubCard;

  const body =
    <ClubCardBody
      cards={cards}
      isOpened={isOpened}
      onPressClub={(name) =>
        openClubCard({ name, anchor: shown.anchor, previous: shown })}
      onIsScrolled={setIsScrolled}
      cache={cache}
    />;

  if (isMobile()) {
    return (
      <ModalBottomSheet
        visible={card !== null}
        onRequestClose={closeClubCard}
        onBackPress={backClubCard}
        heightFraction={0.8}
        header={
          <ClubCardTitle
            name={shown.name}
            isScrolled={isScrolled}
            onBack={onBack}
          />
        }
        onOpened={onOpened}
        onClosed={onClosed}
      >
        {body}
      </ModalBottomSheet>
    );
  }

  const placement = placePopover({
    anchor: shown.anchor,
    window: { width, height },
    width: POPOVER_WIDTH,
    maxHeight: 620,
    minHeight: 360,
    edge: EDGE,
    gap: 8,
  });

  return (
    <Popover
      visible={card !== null}
      onRequestClose={closeClubCard}
      onOpened={onOpened}
      onClosed={onClosed}
      left={placement.left}
      top={placement.top}
      height={placement.height}
    >
      <ClubCardTitle
        name={shown.name}
        isScrolled={isScrolled}
        onBack={onBack}
        onClose={closeClubCard}
      />
      {body}
    </Popover>
  );
};

const ClubHosts = () => {
  const navigation = useNavigation();
  const card = useOpenClubCard();

  useEffect(() => navigation.addListener('state', closeClubs), [navigation]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (card ? closeClubCard : closeClubs)();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [card]);

  return (
    <>
      <ClubsSheetHost />
      <ClubCardHost />
    </>
  );
};

export {
  ClubHosts,
};
