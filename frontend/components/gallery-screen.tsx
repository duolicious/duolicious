import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootParamList } from '../navigation/linking';
import { StatusBarSpacer } from './status-bar-spacer';
import { DefaultText } from './default-text';
import { FloatingBackButton } from './prospect-profile-screen/prospect-profile-screen';
import { Pinchy } from './pinchy';
import type { PinchyDismiss, PinchyPage, PinchyZoom } from './pinchy';
import { dragDismissRadius, dragDistance } from './pinchy-math';
import { IMAGES_URL } from '../env/env';
import { lerp, photoExpandFrame } from '../util/photos';
import type { PhotoExpandFrame, Rect } from '../util/photos';
import { getExpandedPhoto, setExpandedPhoto } from '../events/expanded-photo';
import type { AlbumPhoto, ExpandedPhoto } from '../events/expanded-photo';
import { isMobile } from '../util/util';

const DURATION_MS = 280;

const EASING = Easing.bezier(0.33, 0, 0.15, 1);

// How far (screen px) the photo has to be dragged for the backdrop to fade all
// the way to transparent.
const DISMISS_FADE_RANGE = 300;

const dragBackdropOpacity = (x: number, y: number) => {
  'worklet';
  return 1 - Math.min(1, dragDistance(x, y) / DISMISS_FADE_RANGE);
};

// The back button and click-to-navigate zones are desktop-web only; on mobile
// (native or mobile web) navigation and dismissal are gestures.
const isDesktopWeb = Platform.OS === 'web' && !isMobile();

// 'opening' and 'closing' show the photo mid-expansion and own the screen;
// 'open' hands over to Pinchy, which is the same photo at the same size but
// can be zoomed. A gallery with nothing to expand from starts 'open'.
type Phase = 'opening' | 'open' | 'closing';

// The photo, expanding. Stands in for the preview - which hides itself - so
// that only one instance of the photo is ever apparent. The frame is linear in
// `progress`, so its endpoints are computed once and lerped on the UI thread.
const ExpandingPhoto = ({
  expandedPhoto,
  progress,
  container,
  zoom,
  dismiss,
  scrollX,
  openedX,
  onCovered,
}: {
  expandedPhoto: ExpandedPhoto,
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
  const { photoUuid, from, geometry, borderRadius } = expandedPhoto;

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
      photoExpandFrame(geometry, start, container, 0),
      photoExpandFrame(geometry, start, container, 1),
    ];
  }, [geometry, from, container]);

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
      borderTopLeftRadius: lerp(borderRadius.topLeft, 0, progress.value) + dragRadius,
      borderTopRightRadius: lerp(borderRadius.topRight, 0, progress.value) + dragRadius,
      borderBottomLeftRadius: lerp(borderRadius.bottomLeft, 0, progress.value) + dragRadius,
      borderBottomRightRadius: lerp(borderRadius.bottomRight, 0, progress.value) + dragRadius,
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

  return (
    <Reanimated.View style={[styles.clip, clipStyle]}>
      {/*
        The square rendition the preview was already showing: in cache, so it
        paints on the first frame and holds the photo's place while the
        original decodes.
      */}
      <Reanimated.View style={[styles.image, cropStyle]}>
        <ExpoImage
          source={{ uri: `${IMAGES_URL}/900-${photoUuid}.jpg` }}
          style={StyleSheet.absoluteFill}
          contentFit="fill"
          transition={0}
          cachePolicy="memory-disk"
          onLoad={onCovered}
        />
      </Reanimated.View>
      <Reanimated.View style={[styles.image, imageStyle]}>
        <ExpoImage
          source={{ uri: `${IMAGES_URL}/original-${photoUuid}.jpg` }}
          style={StyleSheet.absoluteFill}
          // The frame already has the photo's aspect ratio, so `fill` matches
          // `contain` without risking a sub-pixel letterbox down one edge.
          contentFit="fill"
          transition={0}
          cachePolicy="memory-disk"
        />
      </Reanimated.View>
    </Reanimated.View>
  );
};

const PagerChevron = ({
  direction,
  onNavigate,
}: {
  direction: -1 | 1,
  onNavigate: (dir: number) => void,
}) => {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      style={[
        styles.chevron,
        direction === -1 ? { left: 14 } : { right: 14 },
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
  );
};

const GalleryScreen = ({
  navigation,
  route,
}: NativeStackScreenProps<RootParamList, 'Gallery Screen'>) => {
  const { photoUuid } = route.params;

  // Captured once: the press stashes this immediately before navigating. Deep
  // links arrive without it, and photos whose geometry the server hasn't
  // recorded can't be expanded, so both fall back to fading the gallery in.
  const [expandedPhoto] = useState<ExpandedPhoto | null>(() => {
    const e = getExpandedPhoto();
    return e?.photoUuid === photoUuid ? e : null;
  });

  const album: AlbumPhoto[] = useMemo(
    () => expandedPhoto?.album ?? [{ uuid: photoUuid, geometry: null }],
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
        ExpoImage.prefetch(`${IMAGES_URL}/original-${photo.uuid}.jpg`);
      } catch (e) {
        console.warn(e);
      }
    });
  }, [album]);

  const [phase, setPhase] = useState<Phase>(
    expandedPhoto ? 'opening' : 'open',
  );

  const progress = useSharedValue(expandedPhoto ? 0 : 1);

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
      scrollX.value = withTiming(index * width, { duration: DURATION_MS, easing: EASING });
      return;
    }
    dismissX.value = 0;
    dismissY.value = 0;
    if (zoomScale.value > 1 + 1e-5) {
      zoomScale.value = withTiming(1, { duration: DURATION_MS, easing: EASING });
      zoomTranslateX.value = withTiming(0, { duration: DURATION_MS, easing: EASING });
      zoomTranslateY.value = withTiming(0, { duration: DURATION_MS, easing: EASING });
      scrollX.value = withTiming(
        target * width,
        { duration: DURATION_MS, easing: EASING },
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
    scrollX.value = withTiming(target * width, { duration: DURATION_MS, easing: EASING });
  }, [album.length, index, width, commitIndex]);

  // Until this screen has drawn the photo over the preview, the preview is
  // still the one on show and nothing may move.
  const [isCovering, setIsCovering] = useState(!expandedPhoto);

  const onCovered = useCallback(() => setIsCovering(true), []);

  // The square rendition comes from cache, so its load event is a formality -
  // but don't hang the animation on one that never arrives.
  useEffect(() => {
    if (!expandedPhoto) return;
    const timeout = setTimeout(onCovered, 250);
    return () => clearTimeout(timeout);
  }, [expandedPhoto, onCovered]);

  useEffect(() => {
    if (!expandedPhoto) return;
    if (!isCovering) return;
    // Nothing is drawn over the preview until the container has been
    // measured, so hiding it before then would leave the photo missing.
    if (!container) return;
    if (isFinishing.current) return;

    setExpandedPhoto({ ...expandedPhoto, covered: true });

    progress.value = withTiming(
      1,
      { duration: DURATION_MS, easing: EASING },
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

  const morphOnClose = expandedPhoto !== null && onOpenedPhoto && !containerMoved;

  const close = useCallback((finish: () => void) => {
    if (isFinishing.current) return;
    isFinishing.current = true;

    backdropAtClose.value =
      dragBackdropOpacity(dismissX.value, dismissY.value);

    // `finish` runs even if the timing is interrupted: better to cut the
    // animation short than to leave the navigation permanently prevented.
    if (morphOnClose) {
      setPhase('closing');
      progress.value = withTiming(
        0,
        { duration: DURATION_MS, easing: EASING },
        () => { runOnJS(finish)(); },
      );
      return;
    }

    // No preview to return to (a deep link, or we paged away from the opened
    // photo): fade the whole gallery out. Let the hidden preview show again
    // now, at the start of the fade, so the profile is already there as the
    // viewer dissolves.
    setExpandedPhoto(null);
    fadeOut.value = withTiming(
      0,
      { duration: DURATION_MS, easing: EASING },
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
      dismissX.value = withTiming(0, { duration: DURATION_MS, easing: EASING });
      dismissY.value = withTiming(0, { duration: DURATION_MS, easing: EASING });
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
        {expandedPhoto && container && onOpenedPhoto &&
          <ExpandingPhoto
            expandedPhoto={expandedPhoto}
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

        {isDesktopWeb && phase === 'open' && index > 0 &&
          <PagerChevron direction={-1} onNavigate={onNavigate} />
        }
        {isDesktopWeb && phase === 'open' && index < album.length - 1 &&
          <PagerChevron direction={1} onNavigate={onNavigate} />
        }

        {album.length > 1 &&
          <View
            style={[
              styles.counter,
              { top: 14 + (Platform.OS === 'web' ? 0 : insets.top) },
            ]}
            pointerEvents="none"
          >
            <DefaultText style={styles.counterText}>
              {index + 1}/{album.length}
            </DefaultText>
          </View>
        }

        <StatusBarSpacer/>
        {isDesktopWeb && <FloatingBackButton onPress={onPressBack}/>}
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
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    // Above Pinchy's 999, like the counter - at 998 it would be unreachable
    // beneath the photo's own stacking context.
    zIndex: 1000,
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
