import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppTheme } from '../../app-theme/app-theme';
import { isMobile } from '../../util/util';
import {
  closeClubCard,
  closeClubs,
  openClubCard,
  useClubsSheet,
  useOpenClubCard,
} from '../../club/club';
import Animated, { FadeIn, FadeOut, runOnJS } from 'react-native-reanimated';
import { ModalBottomSheet } from '../modal/modal-bottom-sheet';
import { ClubsPanel } from './clubs-panel';
import { ClubCardBody, ClubCardTitle } from './club-card';
import { useIsScrolled } from './use-is-scrolled';

const POPOVER_WIDTH = 360;
const EDGE = 8;
const FADE_DURATION = 150;

const useLatest = <T,>(value: T | null): T | null => {
  const ref = useRef(value);

  if (value !== null) {
    ref.current = value;
  }

  return ref.current;
};

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
      style={StyleSheet.absoluteFillObject}
    >
      <Pressable onPress={onRequestClose} style={StyleSheet.absoluteFillObject} />
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
        top={shown.pageY}
      >
        <ClubsPanel />
      </ModalBottomSheet>
    );
  }

  const top = shown.pageY + 6;

  return (
    <Popover
      visible={sheet !== null}
      onRequestClose={closeClubs}
      left={shown.pageX}
      top={top}
      maxHeight={height - top - 2 * EDGE}
    >
      <ClubsPanel />
    </Popover>
  );
};

const ClubCardHost = () => {
  const { height } = useWindowDimensions();
  const card = useOpenClubCard();
  const shown = useLatest(card);
  const { isScrolled, onScroll } = useIsScrolled(shown?.name);
  const [isOpened, setIsOpened] = useState(false);

  if (shown === null) {
    return null;
  }

  const onOpened = () => setIsOpened(true);
  const onClosed = () => setIsOpened(false);

  const body =
    <ClubCardBody
      key={shown.name}
      name={shown.name}
      isOpened={isOpened}
      rowPosition={shown.rowPosition ?? 'front'}
      onPressClub={(name) => openClubCard({ name, anchor: shown.anchor })}
      onScroll={onScroll}
    />;

  if (isMobile()) {
    return (
      <ModalBottomSheet
        visible={card !== null}
        onRequestClose={closeClubCard}
        heightFraction={0.8}
        header={<ClubCardTitle name={shown.name} isScrolled={isScrolled} />}
        onOpened={onOpened}
        onClosed={onClosed}
      >
        {body}
      </ModalBottomSheet>
    );
  }

  const cardHeight = Math.min(620, height - 2 * EDGE);
  const { pageX, pageY } = shown.anchor;

  return (
    <Popover
      visible={card !== null}
      onRequestClose={closeClubCard}
      onOpened={onOpened}
      onClosed={onClosed}
      left={pageX}
      top={pageY > height / 2 ? pageY - cardHeight - 10 : pageY + 10}
      height={cardHeight}
    >
      <ClubCardTitle
        name={shown.name}
        isScrolled={isScrolled}
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
