import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
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
import { FloatingBackButton } from './prospect-profile-screen/prospect-profile-screen';
import { Pinchy } from './pinchy';
import { IMAGES_URL } from '../env/env';
import { photoExpandFrame } from '../util/photos';
import type { PhotoExpandFrame, Rect } from '../util/photos';
import { getExpandedPhoto, setExpandedPhoto } from '../events/expanded-photo';
import type { ExpandedPhoto } from '../events/expanded-photo';

const DURATION_MS = 280;

const EASING = Easing.bezier(0.33, 0, 0.15, 1);

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
  onCovered,
}: {
  expandedPhoto: ExpandedPhoto,
  progress: SharedValue<number>,
  container: Rect,
  onCovered: () => void,
}) => {
  const { photoUuid, from, geometry } = expandedPhoto;

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

  const clipStyle = useAnimatedStyle(() => ({
    left: lerp(closed.clip.x, opened.clip.x, progress.value),
    top: lerp(closed.clip.y, opened.clip.y, progress.value),
    width: lerp(closed.clip.width, opened.clip.width, progress.value),
    height: lerp(closed.clip.height, opened.clip.height, progress.value),
  }));

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

  const [phase, setPhase] = useState<Phase>(
    expandedPhoto ? 'opening' : 'open',
  );

  const progress = useSharedValue(expandedPhoto ? 0 : 1);

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
    // The photo can finish loading after a quick back-press has already
    // started closing. Opening from there would fight the closing animation,
    // and would re-hide a preview that nothing is left to reveal again.
    if (isFinishing.current) return;

    // Only now is it safe for the preview to get out of the way.
    setExpandedPhoto({ ...expandedPhoto, covered: true });

    progress.value = withTiming(
      1,
      { duration: DURATION_MS, easing: EASING },
      (finished) => {
        if (finished) runOnJS(setPhase)('open');
      },
    );
  }, [expandedPhoto, isCovering, container]);

  const backdropStyle = useAnimatedStyle(() => ({
    // Runs ahead of the photo so the preview underneath is covered by the time
    // the photo has moved off it, without blinking the profile out at the very
    // start of the press.
    opacity: Math.min(1, progress.value * 2),
  }));

  const close = useCallback((finish: () => void) => {
    if (isFinishing.current) return;
    isFinishing.current = true;

    if (!expandedPhoto) {
      setExpandedPhoto(null);
      finish();
      return;
    }

    setPhase('closing');

    progress.value = withTiming(
      0,
      { duration: DURATION_MS, easing: EASING },
      (finished) => {
        if (finished) runOnJS(finish)();
      },
    );
  }, [expandedPhoto]);

  // Reveal the preview before popping. The photo has landed back on top of it
  // and the two coincide exactly, so the handover is invisible; popping first
  // would flash the empty slot for a frame.
  const finishAndPop = useCallback((pop: () => void) => {
    setExpandedPhoto(null);
    pop();
  }, []);

  // Also covers the Android hardware back button and the browser's back
  // button, either of which would otherwise pop the screen out from under the
  // animation.
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e) => {
      if (isFinishing.current) return;

      e.preventDefault();
      close(() => finishAndPop(() => navigation.dispatch(e.data.action)));
    });
  }, [navigation, close, finishAndPop]);

  const onPressBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View
      ref={containerRef}
      onLayout={onContainerLayout}
      style={StyleSheet.absoluteFill}
    >
      <Reanimated.View
        style={[styles.backdrop, expandedPhoto ? backdropStyle : undefined]}
      />
      {expandedPhoto && container &&
        <ExpandingPhoto
          expandedPhoto={expandedPhoto}
          progress={progress}
          container={container}
          onCovered={onCovered}
        />
      }
      {phase === 'open' &&
        <Pinchy
          uuid={photoUuid}
          naturalSize={expandedPhoto?.geometry}
          // Both copies of the photo have to be sized and centred against the
          // same box, or they land in different places and you see the two of
          // them at the end of the expansion.
          viewport={container ?? undefined}
          // The expanded photo is drawn underneath and is pixel-identical at
          // this point, so it - rather than a black box - is what shows while
          // Pinchy's own copy of the image paints.
          backgroundColor={expandedPhoto ? 'transparent' : 'black'}
        />
      }
      <StatusBarSpacer/>
      <FloatingBackButton onPress={onPressBack}/>
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
});

export {
  GalleryScreen,
};
