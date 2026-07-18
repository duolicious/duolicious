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
import type { RootParamList } from '../navigation/linking';
import { StatusBarSpacer } from './status-bar-spacer';
import { DefaultText } from './default-text';
import { FloatingBackButton } from './prospect-profile-screen/prospect-profile-screen';
import { Pinchy } from './pinchy';
import type { PinchyDismiss, PinchyPage, PinchyZoom } from './pinchy';
import { dragDismissRadius } from './pinchy-math';
import { IMAGES_URL } from '../env/env';
import { photoExpandFrame } from '../util/photos';
import type { PhotoExpandFrame, Rect } from '../util/photos';
import { getExpandedPhoto, setExpandedPhoto } from '../events/expanded-photo';
import type { AlbumPhoto, ExpandedPhoto } from '../events/expanded-photo';
import { isMobile } from '../util/util';

const DURATION_MS = 280;

const EASING = Easing.bezier(0.33, 0, 0.15, 1);

// How far (screen px) the photo has to be dragged for the backdrop to fade all
// the way to transparent, revealing the profile it dismisses back to.
const DISMISS_FADE_RANGE = 300;

// The back button and click-to-navigate zones are desktop-web only; on mobile
// (native or mobile web) navigation and dismissal are gestures.
const isDesktopWeb = Platform.OS === 'web' && !isMobile();

// 'opening' and 'closing' show the photo mid-expansion and own the screen;
// 'open' hands over to Pinchy, which is the same photo at the same size but
// can be zoomed. A gallery with nothing to expand from starts 'open'.
type Phase = 'opening' | 'open' | 'closing';

const lerp = (a: number, b: number, t: number) => {
  'worklet';
  return a + (b - a) * t;
};

// The photo, expanding. Stands in for the preview - which hides itself - so
// that only one instance of the photo is ever apparent. The frame is linear in
// `progress`, so its endpoints are computed once here and lerped on the UI
// thread. See `photoExpandFrame`.
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
  // the pager and stays hidden under the current photo during a swipe.
  scrollX: SharedValue<number>,
  openedX: number,
  onCovered: () => void,
}) => {
  const { photoUuid, from, geometry, borderRadius } = expandedPhoto;

  const [closed, opened] = useMemo((): [PhotoExpandFrame, PhotoExpandFrame] => {
    // `from` was measured in window coordinates, but this draws inside the
    // gallery's container, which isn't necessarily the window: on Android the
    // window excludes the system bars while the modal spans the whole screen.
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
  // so closing carries it out from wherever the user left it rather than
  // snapping back to fitted first. The zoom unwinds as the photo returns to the
  // preview, where it has to be identity. Same order as Pinchy's own transform.
  const clipStyle = useAnimatedStyle(() => {
    // A dismiss drag rounds all four corners uniformly; it's added on top of
    // the open/close rounding so the corners match the dragged photo at the
    // hand-off, then unwinds to the preview's radii as the close plays out.
    const dragRadius = dragDismissRadius(dismiss.x.value, dismiss.y.value);

    return {
    left: lerp(closed.clip.x, opened.clip.x, progress.value),
    top: lerp(closed.clip.y, opened.clip.y, progress.value),
    width: lerp(closed.clip.width, opened.clip.width, progress.value),
    height: lerp(closed.clip.height, opened.clip.height, progress.value),
    // Rounded like the preview at the start, square once it fills the screen.
    borderTopLeftRadius: lerp(borderRadius.topLeft, 0, progress.value) + dragRadius,
    borderTopRightRadius: lerp(borderRadius.topRight, 0, progress.value) + dragRadius,
    borderBottomLeftRadius: lerp(borderRadius.bottomLeft, 0, progress.value) + dragRadius,
    borderBottomRightRadius: lerp(borderRadius.bottomRight, 0, progress.value) + dragRadius,
    transform: [
      // Track the pager so the morph slides with the current photo (and out of
      // sight) as it's swiped, plus a dismiss drag carried in from the open
      // photo. Both screen-space, outermost, so the zoom scale doesn't
      // multiply them.
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
        The square rendition the preview was already showing. It's in cache, so
        it paints on the first frame - which it covers exactly - and holds the
        photo's place while the original decodes.
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

  // The photos to page between, and where we started. A deep link with no
  // album is a one-photo gallery.
  const album: AlbumPhoto[] = useMemo(
    () => expandedPhoto?.album ?? [{ uuid: photoUuid, geometry: null }],
    [expandedPhoto, photoUuid],
  );
  const openedIndex = useMemo(
    () => Math.max(0, album.findIndex((p) => p.uuid === photoUuid)),
    [album, photoUuid],
  );

  const [index, setIndex] = useState(openedIndex);
  const current = album[index] ?? album[0];

  // Warm the cache for every photo's full-size original the moment the gallery
  // opens. The profile only loaded the cropped preview renditions, so without
  // this the first swipe to a neighbour flashes blank while its original loads.
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

  // A fixed identity transform for the off-screen pages, which aren't zoomable.
  // Only the current page gets the live `zoom`.
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

  // Everything here is positioned within this container rather than within the
  // window, and it's measured rather than assumed to be the window: on Android
  // the two differ by the system bars, and anything working in window
  // coordinates ends up offset from anything working in the container's.
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

  const width = container?.width ?? 0;

  // The pager's horizontal scroll, in px. Slots sit at absolute `i * width`, so
  // this settles at `index * width`; changing `index` alone never shifts a slot
  // and so never flickers.
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

  // Move to another photo, sliding the pager and resetting the zoom/dismiss of
  // the photo we're leaving.
  const goTo = useCallback((next: number) => {
    const target = Math.max(0, Math.min(album.length - 1, next));
    if (target === index) {
      scrollX.value = withTiming(index * width, { duration: DURATION_MS, easing: EASING });
      return;
    }
    zoomScale.value = 1;
    zoomTranslateX.value = 0;
    zoomTranslateY.value = 0;
    dismissX.value = 0;
    dismissY.value = 0;
    setIndex(target);
    scrollX.value = withTiming(target * width, { duration: DURATION_MS, easing: EASING });
  }, [album.length, index, width]);

  // Until this screen has drawn the photo over the preview, the preview is
  // still the one on show and nothing may move: the first frame has to be
  // indistinguishable from the screen underneath.
  const [isCovering, setIsCovering] = useState(!expandedPhoto);

  const onCovered = useCallback(() => setIsCovering(true), []);

  // The square rendition is the one the preview is already displaying, so it
  // comes from cache and this is a formality - but don't hang the animation on
  // a load event that never arrives.
  useEffect(() => {
    if (!expandedPhoto) return;
    const timeout = setTimeout(onCovered, 250);
    return () => clearTimeout(timeout);
  }, [expandedPhoto, onCovered]);

  useEffect(() => {
    if (!expandedPhoto) return;
    if (!isCovering) return;
    // Nothing is drawn over the preview until the container has been measured,
    // so hiding it before then would leave the photo missing.
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

  const backdropStyle = useAnimatedStyle(() => {
    const opened = Math.min(1, progress.value * 2);
    const dragged = Math.sqrt(dismissX.value ** 2 + dismissY.value ** 2);
    const notDragged = 1 - Math.min(1, dragged / DISMISS_FADE_RANGE);
    return { opacity: opened * notDragged };
  });

  // The open/close morph only makes sense for the photo we opened; once paged
  // away, there's nothing on the profile to morph back to.
  const onOpenedPhoto = index === openedIndex;

  const close = useCallback((finish: () => void) => {
    if (isFinishing.current) return;
    isFinishing.current = true;

    if (expandedPhoto && onOpenedPhoto) {
      // Reverse the expand back into the preview.
      setPhase('closing');
      progress.value = withTiming(
        0,
        { duration: DURATION_MS, easing: EASING },
        (finished) => { if (finished) runOnJS(finish)(); },
      );
      return;
    }

    // No preview to return to (a deep link, or we paged away from the opened
    // photo): fade the whole gallery out to reveal the screen underneath. Let
    // the hidden preview show again now, at the start of the fade, so the
    // profile is already there as the viewer dissolves rather than popping in
    // once it's gone.
    setExpandedPhoto(null);
    fadeOut.value = withTiming(
      0,
      { duration: DURATION_MS, easing: EASING },
      (finished) => { if (finished) runOnJS(finish)(); },
    );
  }, [expandedPhoto, onOpenedPhoto]);

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
    // On the opened photo the reverse-morph carries the drag back into the
    // preview, so unwind it over the same time. Paged away, the gallery just
    // fades from where the photo was flicked - leave the offset be.
    if (onOpenedPhoto) {
      dismissX.value = withTiming(0, { duration: DURATION_MS, easing: EASING });
      dismissY.value = withTiming(0, { duration: DURATION_MS, easing: EASING });
    }
    onPressBack();
  }, [onPressBack, onOpenedPhoto, dismissX, dismissY]);

  // A horizontal swipe past the threshold pages; onEnd hands us the direction.
  const onNavigate = useCallback((dir: number) => {
    goTo(index + dir);
  }, [goTo, index]);

  return (
    <View
      ref={containerRef}
      onLayout={onContainerLayout}
      style={StyleSheet.absoluteFill}
    >
     <Reanimated.View style={[StyleSheet.absoluteFill, fadeStyle]}>
      <Reanimated.View
        style={[styles.backdrop, expandedPhoto ? backdropStyle : undefined]}
      />

      {/*
        Stays mounted under the pager for the opened photo, so it covers the
        moment the pager's interactive copy mounts (opening) and unmounts
        (closing) - otherwise that hand-off flickers. It tracks the pager
        scroll, so during a swipe it slides away with the photo rather than
        peeking out from under it.
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
                dismiss={i === index && expandedPhoto ? dismiss : undefined}
                onDismiss={i === index && expandedPhoto ? onDismiss : undefined}
                page={i === index && album.length > 1 ? page : undefined}
                onNavigate={i === index && album.length > 1 ? onNavigate : undefined}
                viewport={container}
                backgroundColor={i === index && onOpenedPhoto && expandedPhoto ? 'transparent' : 'black'}
              />
            </View>
          ))}
        </Reanimated.View>
      }

      {/* Desktop: click the left/right edge to page. */}
      {isDesktopWeb && album.length > 1 && phase === 'open' &&
        <>
          <Pressable
            style={[styles.edgeZone, { left: 0 }]}
            onPress={() => onNavigate(-1)}
            disabled={index === 0}
          />
          <Pressable
            style={[styles.edgeZone, { right: 0 }]}
            onPress={() => onNavigate(1)}
            disabled={index === album.length - 1}
          />
        </>
      }

      {album.length > 1 &&
        <View style={styles.counter} pointerEvents="none">
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
  edgeZone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '30%',
    zIndex: 998,
  },
  counter: {
    position: 'absolute',
    top: 14,
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
