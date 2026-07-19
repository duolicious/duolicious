import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootParamList } from '../navigation/linking';
import { DefaultText } from './default-text';
import { useBackButtonClaim } from '../events/back-button';
import { Pinchy } from './pinchy';
import type { PinchyDismiss, PinchyPage, PinchyZoom } from './pinchy';
import { dragDismissRadius, dragDistance } from './pinchy-math';
import { FillImage } from './fill-image';
import {
  hasGifExtraExt,
  lerp,
  photoContainFrame,
  photoExpandFrame,
  photoUri,
} from '../util/photos';
import type { PhotoExpandFrame, Rect } from '../util/photos';
import {
  ZERO_BORDER_RADII,
  getExpandedPhoto,
  setExpandedPhoto,
} from '../events/expanded-photo';
import type { AlbumPhoto, ExpandedPhoto, ExpandedPhotoMorph } from '../events/expanded-photo';
import { isMobile } from '../util/util';
import { TIMING } from '../util/animation';

// How far (screen px) the photo has to be dragged for the backdrop to fade all
// the way to transparent.
const DISMISS_FADE_RANGE = 300;

const dragBackdropOpacity = (x: number, y: number) => {
  'worklet';
  return 1 - Math.min(1, dragDistance(x, y) / DISMISS_FADE_RANGE);
};

// The click-to-navigate zones are desktop-web only; on mobile (native or
// mobile web) navigation is a gesture.
const isDesktopWeb = Platform.OS === 'web' && !isMobile();

// 'opening' and 'closing' show the photo mid-expansion and own the screen;
// 'open' hands over to Pinchy, which is the same photo at the same size but
// can be zoomed. A gallery with nothing to expand from starts 'open'.
type Phase = 'opening' | 'open' | 'closing';

// The photo, expanding. Stands in for the preview - which hides itself - so
// that only one instance of the photo is ever apparent. The frame is linear in
// `progress`, so its endpoints are computed once and lerped on the UI thread.
const ExpandingPhoto = ({
  photoUuid,
  photoExtraExts,
  morph,
  progress,
  container,
  zoom,
  dismiss,
  scrollX,
  openedX,
  onCovered,
}: {
  photoUuid: string,
  photoExtraExts: string[],
  morph: ExpandedPhotoMorph,
  progress: SharedValue<number>,
  container: Rect,
  zoom: PinchyZoom,
  dismiss: PinchyDismiss,
  // The pager's scroll, and this photo's resting scroll, so the morph tracks
  // the pager during a swipe.
  scrollX: SharedValue<number>,
  openedX: number,
  onCovered: () => void,
}) => {
  const { from, geometry, borderRadius } = morph;

  const isGif = hasGifExtraExt(photoExtraExts);

  const frameAt = isGif ? photoContainFrame : photoExpandFrame;

  const radii = isGif && geometry.width !== geometry.height
    ? ZERO_BORDER_RADII
    : borderRadius;

  const [closed, opened] = useMemo((): [PhotoExpandFrame, PhotoExpandFrame] => {
    // `from` was measured in window coordinates, but this draws inside the
    // gallery's container: on Android the window excludes the system bars
    // while the modal spans the whole screen.
    const start: Rect = {
      ...from,
      x: from.x - container.x,
      y: from.y - container.y,
    };

    return [
      frameAt(geometry, start, container, 0),
      frameAt(geometry, start, container, 1),
    ];
  }, [geometry, from, container, frameAt]);

  // At `progress` 1 this is the photo exactly as Pinchy has it, zoom and all,
  // so closing carries it out from wherever the user left it. Same transform
  // order as Pinchy's.
  const clipStyle = useAnimatedStyle(() => {
    // A dismiss drag rounds all four corners on top of the open/close
    // rounding, so the corners match the dragged photo at the hand-off.
    const dragRadius = dragDismissRadius(dismiss.x.value, dismiss.y.value);

    return {
      left: lerp(closed.clip.x, opened.clip.x, progress.value),
      top: lerp(closed.clip.y, opened.clip.y, progress.value),
      width: lerp(closed.clip.width, opened.clip.width, progress.value),
      height: lerp(closed.clip.height, opened.clip.height, progress.value),
      borderTopLeftRadius: lerp(radii.topLeft, 0, progress.value) + dragRadius,
      borderTopRightRadius: lerp(radii.topRight, 0, progress.value) + dragRadius,
      borderBottomLeftRadius: lerp(radii.bottomLeft, 0, progress.value) + dragRadius,
      borderBottomRightRadius: lerp(radii.bottomRight, 0, progress.value) + dragRadius,
      transform: [
        // The pager offset and dismiss drag are screen-space, so they go
        // outermost, ahead of the zoom scale.
        { translateX: (openedX - scrollX.value) + dismiss.x.value },
        { translateY: dismiss.y.value },
        { scale: lerp(1, zoom.scale.value, progress.value) },
        { translateX: lerp(0, zoom.translateX.value, progress.value) },
        { translateY: lerp(0, zoom.translateY.value, progress.value) },
      ],
    };
  });

  const imageStyle = useAnimatedStyle(() => ({
    left: lerp(closed.image.x, opened.image.x, progress.value),
    top: lerp(closed.image.y, opened.image.y, progress.value),
    width: lerp(closed.image.width, opened.image.width, progress.value),
    height: lerp(closed.image.height, opened.image.height, progress.value),
  }));

  const cropStyle = useAnimatedStyle(() => ({
    left: lerp(closed.crop.x, opened.crop.x, progress.value),
    top: lerp(closed.crop.y, opened.crop.y, progress.value),
    width: lerp(closed.crop.width, opened.crop.width, progress.value),
    height: lerp(closed.crop.height, opened.crop.height, progress.value),
  }));

  if (isGif) {
    return (
      <Reanimated.View style={[styles.clip, clipStyle]}>
        <Reanimated.View style={[styles.image, imageStyle]}>
          <FillImage
            uri={photoUri(photoUuid, 'original', photoExtraExts)}
            onLoad={onCovered}
          />
        </Reanimated.View>
      </Reanimated.View>
    );
  }

  return (
    <Reanimated.View style={[styles.clip, clipStyle]}>
      {/*
        The square rendition the preview was already showing: in cache, so it
        paints on the first frame and holds the photo's place while the
        original decodes.
      */}
      <Reanimated.View style={[styles.image, cropStyle]}>
        <FillImage
          uri={photoUri(photoUuid, 900)}
          onLoad={onCovered}
        />
      </Reanimated.View>
      <Reanimated.View style={[styles.image, imageStyle]}>
        <FillImage uri={photoUri(photoUuid, 'original')} />
      </Reanimated.View>
    </Reanimated.View>
  );
};

const PagerChevron = ({
  direction,
  onNavigate,
  opacity,
  enabled,
}: {
  direction: -1 | 1,
  onNavigate: (dir: number) => void,
  opacity: SharedValue<number>,
  enabled: boolean,
}) => {
  const [hovered, setHovered] = useState(false);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Reanimated.View
      style={[
        styles.chevron,
        direction === -1 ? { left: 14 } : { right: 14 },
        fadeStyle,
      ]}
      pointerEvents={enabled ? 'auto' : 'none'}
    >
      <Pressable
        style={[
          styles.chevronButton,
          hovered ? styles.chevronHovered : null,
        ]}
        onPress={() => onNavigate(direction)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
      >
        <Ionicons
          name={direction === -1 ? 'chevron-back' : 'chevron-forward'}
          size={26}
          color="white"
        />
      </Pressable>
    </Reanimated.View>
  );
};

const GalleryScreen = ({
  navigation,
  route,
}: NativeStackScreenProps<RootParamList, 'Gallery Screen'>) => {
  const { photoUuid } = route.params;

  // Captured once: the press stashes this immediately before navigating. Deep
  // links arrive without it, which leaves a one-photo gallery.
  const [expandedPhoto] = useState<ExpandedPhoto | null>(() => {
    const e = getExpandedPhoto();
    return e?.photoUuid === photoUuid ? e : null;
  });

  const morph = expandedPhoto?.morph ?? null;

  const album: AlbumPhoto[] = useMemo(
    () => expandedPhoto?.album
      ?? [{ uuid: photoUuid, extraExts: [], geometry: null }],
    [expandedPhoto, photoUuid],
  );
  const openedIndex = useMemo(
    () => Math.max(0, album.findIndex((p) => p.uuid === photoUuid)),
    [album, photoUuid],
  );

  const [index, setIndex] = useState(openedIndex);

  // Warm the cache for every photo's full-size original, so the first swipe
  // to a neighbour doesn't flash blank while its original loads.
  useEffect(() => {
    album.forEach((photo) => {
      try {
        ExpoImage.prefetch(photoUri(photo.uuid, 'original', photo.extraExts));
      } catch (e) {
        console.warn(e);
      }
    });
  }, [album]);

  const [phase, setPhase] = useState<Phase>(
    morph ? 'opening' : 'open',
  );

  const progress = useSharedValue(morph ? 0 : 1);

  // Lives here rather than inside Pinchy so the photo can be animated out from
  // wherever the user pinched it to, after Pinchy itself has gone.
  const zoomScale = useSharedValue(1);
  const zoomTranslateX = useSharedValue(0);
  const zoomTranslateY = useSharedValue(0);

  const zoom: PinchyZoom = useMemo(() => ({
    scale: zoomScale,
    translateX: zoomTranslateX,
    translateY: zoomTranslateY,
  }), [zoomScale, zoomTranslateX, zoomTranslateY]);

  // A fixed identity transform for the off-screen pages, which aren't
  // zoomable.
  const identityScale = useSharedValue(1);
  const identityZero = useSharedValue(0);
  const identityZoom: PinchyZoom = useMemo(() => ({
    scale: identityScale,
    translateX: identityZero,
    translateY: identityZero,
  }), [identityScale, identityZero]);

  // Where a drag-to-dismiss has moved the photo. Owned here so the closing
  // animation can unwind it and the backdrop can fade by how far it's dragged.
  const dismissX = useSharedValue(0);
  const dismissY = useSharedValue(0);

  const dismiss: PinchyDismiss = useMemo(() => ({
    x: dismissX,
    y: dismissY,
  }), [dismissX, dismissY]);

  // Fades the whole gallery out when there's no preview to morph back into.
  const fadeOut = useSharedValue(1);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeOut.value }));

  const chromeIn = useSharedValue(morph ? 1 : 0);
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: Math.min(chromeIn.value, progress.value),
  }));

  useEffect(() => {
    if (morph) return;
    chromeIn.value = withTiming(1, TIMING);
  }, []);

  const prevIn = useSharedValue(openedIndex > 0 ? 1 : 0);
  const nextIn = useSharedValue(openedIndex < album.length - 1 ? 1 : 0);

  useEffect(() => {
    prevIn.value = withTiming(index > 0 ? 1 : 0, TIMING);
    nextIn.value = withTiming(index < album.length - 1 ? 1 : 0, TIMING);
  }, [index, album.length]);

  const prevChevronOpacity = useDerivedValue(() =>
    Math.min(chromeIn.value, progress.value) * prevIn.value);
  const nextChevronOpacity = useDerivedValue(() =>
    Math.min(chromeIn.value, progress.value) * nextIn.value);

  const isFinishing = useRef(false);

  const insets = useSafeAreaInsets();

  // Everything here is positioned within this container, which is measured
  // rather than assumed to be the window: on Android the two differ by the
  // system bars.
  const containerRef = useRef<View>(null);
  const [container, setContainer] = useState<Rect | null>(null);

  const onContainerLayout = useCallback(() => {
    containerRef.current?.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;

      // Keep the identity stable when nothing moved, so a repeat layout pass
      // doesn't restart the animation.
      setContainer((previous) =>
        previous
          && previous.x === x
          && previous.y === y
          && previous.width === width
          && previous.height === height
          ? previous
          : { x, y, width, height }
      );
    });
  }, []);

  // `from` was measured when the preview was pressed, so a resize or rotation
  // since then leaves it pointing at where the preview used to be. Closing
  // falls back to the fade rather than morphing to the wrong place.
  const openContainer = useRef<Rect | null>(null);
  const [containerMoved, setContainerMoved] = useState(false);

  useEffect(() => {
    if (!container) return;
    if (openContainer.current === null) {
      openContainer.current = container;
      return;
    }
    if (container !== openContainer.current) setContainerMoved(true);
  }, [container]);

  const width = container?.width ?? 0;

  // The pager's horizontal scroll, in px. Slots sit at absolute `i * width`,
  // so this settles at `index * width`; changing `index` alone never shifts a
  // slot and so never flickers.
  const scrollX = useSharedValue(0);
  useEffect(() => {
    scrollX.value = index * width;
  }, [width]); // re-home only on a resize; navigation animates scrollX itself

  const page: PinchyPage = useMemo(() => ({
    scrollX,
    homeX: index * width,
    width,
    count: album.length,
  }), [scrollX, index, width, album.length]);

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -scrollX.value }],
  }));

  // The live zoom belongs to the page at `index`, so the index can only
  // change while the zoom is at identity - and not mid-close, where it would
  // unmount the morphing photo.
  const commitIndex = useCallback((target: number) => {
    if (isFinishing.current) return;
    setIndex(target);
  }, []);

  // Leaving a zoomed photo unzooms it in step with the slide, deferring the
  // index - and with it, which page owns the live zoom - until both land.
  const goTo = useCallback((next: number) => {
    const target = Math.max(0, Math.min(album.length - 1, next));
    if (target === index) {
      scrollX.value = withTiming(index * width, TIMING);
      return;
    }
    dismissX.value = 0;
    dismissY.value = 0;
    if (zoomScale.value > 1 + 1e-5) {
      zoomScale.value = withTiming(1, TIMING);
      zoomTranslateX.value = withTiming(0, TIMING);
      zoomTranslateY.value = withTiming(0, TIMING);
      scrollX.value = withTiming(
        target * width,
        TIMING,
        (finished) => {
          if (finished) runOnJS(commitIndex)(target);
        },
      );
      return;
    }
    zoomScale.value = 1;
    zoomTranslateX.value = 0;
    zoomTranslateY.value = 0;
    setIndex(target);
    scrollX.value = withTiming(target * width, TIMING);
  }, [album.length, index, width, commitIndex]);

  // Until this screen has drawn the photo over the preview, the preview is
  // still the one on show and nothing may move.
  const [isCovering, setIsCovering] = useState(!morph);

  const onCovered = useCallback(() => setIsCovering(true), []);

  // The square rendition comes from cache, so its load event is a formality -
  // but don't hang the animation on one that never arrives.
  useEffect(() => {
    if (!morph) return;
    const timeout = setTimeout(onCovered, 250);
    return () => clearTimeout(timeout);
  }, [morph, onCovered]);

  useEffect(() => {
    if (!expandedPhoto || !morph) return;
    if (!isCovering) return;
    // Nothing is drawn over the preview until the container has been
    // measured, so hiding it before then would leave the photo missing.
    if (!container) return;
    if (isFinishing.current) return;

    setExpandedPhoto({ ...expandedPhoto, covered: true });

    progress.value = withTiming(
      1,
      TIMING,
      (finished) => {
        if (finished) runOnJS(setPhase)('open');
      },
    );
  }, [expandedPhoto, isCovering, container]);

  // However this screen goes away, the preview it hid must come back.
  useEffect(() => {
    return () => setExpandedPhoto(null);
  }, []);

  // The backdrop opacity when the close began. Dismissing unwinds the drag
  // offset while the photo morphs home, and without this cap the drag fade
  // would recover with it, flashing the backdrop back to black mid-close.
  const backdropAtClose = useSharedValue(1);

  const backdropStyle = useAnimatedStyle(() => {
    const opened = Math.min(1, progress.value * 2);
    const notDragged = dragBackdropOpacity(dismissX.value, dismissY.value);
    return { opacity: opened * Math.min(notDragged, backdropAtClose.value) };
  });

  // The open/close morph only makes sense for the photo we opened; once paged
  // away, there's nothing on the profile to morph back to.
  const onOpenedPhoto = index === openedIndex;

  const morphOnClose = morph !== null && onOpenedPhoto && !containerMoved;

  const closeBackButtonClaim = useBackButtonClaim({
    layout: 'window',
    transition: 'fade',
    onPress: () => onPressBack(),
  });

  const close = useCallback((finish: () => void) => {
    if (isFinishing.current) return;
    isFinishing.current = true;

    closeBackButtonClaim();

    backdropAtClose.value =
      dragBackdropOpacity(dismissX.value, dismissY.value);

    // `finish` runs even if the timing is interrupted: better to cut the
    // animation short than to leave the navigation permanently prevented.
    if (morphOnClose) {
      setPhase('closing');
      progress.value = withTiming(
        0,
        TIMING,
        () => { runOnJS(finish)(); },
      );
      return;
    }

    // No preview to morph back into (a deep link, a photo with no geometry,
    // or we paged away from the opened photo): fade the whole gallery out.
    // Let any hidden preview show again now, at the start of the fade, so the
    // profile is already there as the viewer dissolves.
    setExpandedPhoto(null);
    fadeOut.value = withTiming(
      0,
      TIMING,
      () => { runOnJS(finish)(); },
    );
  }, [morphOnClose]);

  const finishAndPop = useCallback((pop: () => void) => {
    setExpandedPhoto(null);
    pop();
  }, []);

  useEffect(() => {
    return navigation.addListener('beforeRemove', (e) => {
      if (isFinishing.current) return;
      e.preventDefault();
      close(() => finishAndPop(() => navigation.dispatch(e.data.action)));
    });
  }, [navigation, close, finishAndPop]);

  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    close(() => finishAndPop(() => navigation.reset({ routes: [{ name: 'Home' }] })));
  }, [navigation, close, finishAndPop]);

  const onDismiss = useCallback(() => {
    // The reverse-morph carries the drag back into the preview, so unwind it
    // over the same time. Without a morph the gallery just fades from where
    // the photo was flicked - leave the offset be.
    if (morphOnClose) {
      dismissX.value = withTiming(0, TIMING);
      dismissY.value = withTiming(0, TIMING);
    }
    onPressBack();
  }, [onPressBack, morphOnClose, dismissX, dismissY]);

  const onNavigate = useCallback((dir: number) => {
    goTo(index + dir);
  }, [goTo, index]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onPressBack();
      // Not while the open/close morph owns the screen: paging then would pull
      // the expanding photo out from under it.
      if (e.key === 'ArrowLeft' && phase === 'open') onNavigate(-1);
      if (e.key === 'ArrowRight' && phase === 'open') onNavigate(1);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onPressBack, onNavigate, phase]);

  return (
    <View
      ref={containerRef}
      onLayout={onContainerLayout}
      style={StyleSheet.absoluteFill}
    >
      <Reanimated.View style={[StyleSheet.absoluteFill, fadeStyle]}>
        <Reanimated.View style={[styles.backdrop, backdropStyle]} />

        {/*
          Stays mounted under the pager for the opened photo, so it covers the
          moment the pager's interactive copy mounts (opening) and unmounts
          (closing) - otherwise that hand-off flickers.
        */}
        {morph && container && onOpenedPhoto &&
          <ExpandingPhoto
            photoUuid={photoUuid}
            photoExtraExts={album[openedIndex].extraExts}
            morph={morph}
            progress={progress}
            container={container}
            zoom={zoom}
            dismiss={dismiss}
            scrollX={scrollX}
            openedX={openedIndex * width}
            onCovered={onCovered}
          />
        }

        {phase === 'open' && container &&
          <Reanimated.View style={[StyleSheet.absoluteFill, rowStyle]}>
            {album.map((photo, i) => Math.abs(i - index) > 1 ? null : (
              <View
                key={photo.uuid}
                style={[styles.slot, { left: i * width, width, height: container.height }]}
              >
                <Pinchy
                  uuid={photo.uuid}
                  extraExts={photo.extraExts}
                  naturalSize={photo.geometry ?? undefined}
                  zoom={i === index ? zoom : identityZoom}
                  dismiss={i === index ? dismiss : undefined}
                  onDismiss={i === index ? onDismiss : undefined}
                  page={i === index && album.length > 1 ? page : undefined}
                  onNavigate={i === index && album.length > 1 ? onNavigate : undefined}
                  onTapEdge={
                    isDesktopWeb && i === index && album.length > 1
                      ? onNavigate
                      : undefined
                  }
                  viewport={container}
                  backgroundColor={i === index ? 'transparent' : 'black'}
                />
              </View>
            ))}
          </Reanimated.View>
        }

        {isDesktopWeb && album.length > 1 && <>
          <PagerChevron
            direction={-1}
            onNavigate={onNavigate}
            opacity={prevChevronOpacity}
            enabled={phase === 'open' && index > 0}
          />
          <PagerChevron
            direction={1}
            onNavigate={onNavigate}
            opacity={nextChevronOpacity}
            enabled={phase === 'open' && index < album.length - 1}
          />
        </>}

        {album.length > 1 &&
          <Reanimated.View
            style={[
              styles.counter,
              { top: 14 + (Platform.OS === 'web' ? 0 : insets.top) },
              chromeStyle,
            ]}
            pointerEvents="none"
          >
            <DefaultText style={styles.counterText}>
              {index + 1}/{album.length}
            </DefaultText>
          </Reanimated.View>
        }

      </Reanimated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'black',
  },
  clip: {
    position: 'absolute',
    overflow: 'hidden',
  },
  image: {
    position: 'absolute',
  },
  slot: {
    position: 'absolute',
    top: 0,
  },
  chevron: {
    position: 'absolute',
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    // Above Pinchy's 999, like the counter - at 998 it would be unreachable
    // beneath the photo's own stacking context.
    zIndex: 1000,
  },
  chevronButton: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronHovered: {
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  counter: {
    position: 'absolute',
    right: 14,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    zIndex: 1000,
  },
  counterText: {
    color: 'white',
    fontFamily: 'MontserratSemiBold',
    fontSize: 14,
  },
});

export {
  GalleryScreen,
};
