import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { LogoActivityIndicator } from './logo/logo-activity-indicator';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import Animated, {
  AnimatedStyle,
  Easing,
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { FillImage } from './fill-image';
import type { VideoPlayer } from 'expo-video';
import {
  VideoControls,
  unmuteVideos,
  useControlsVisibility,
  useVideoMuted,
} from './looping-video';
import { useSharedVideo } from './shared-video';
import { VideoSurface } from './video-surface';
import { hasGifExtraExt, photoUri, videoUri } from '../util/photos';
import type { PhotoGeometry } from '../util/photos';
import {
  constrainPosition,
  dragDismissRadius,
  dragDistance,
  focalZoomPosition,
  lockedDragMode,
  pageNavDirection,
} from './pinchy-math';

// Double-tap zoom eases in rather than snapping. A pinch or pan writing the
// shared values directly cancels it mid-flight, which is what you want.
const ZOOM_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) };

// Dragging the zoomed-out photo at least this far (screen px) before lifting
// dismisses the gallery; a shorter drag returns the photo to centre.
const DISMISS_THRESHOLD = 55;

// Sideways drag this far (screen px) before lifting pages to the neighbour.
const NAV_THRESHOLD = 55;

// A sideways flick released faster than this (screen px/s) pages even when it
// travelled less than NAV_THRESHOLD.
const NAV_FLING_VELOCITY = 500;

// A drag that doesn't dismiss returns in one motion, no spring wobble.
const DISMISS_RETURN = { duration: 200, easing: Easing.out(Easing.cubic) };

// Shrink an image to fit the viewport, never enlarging it past native size.
const fitWithin = (
  size: { width: number, height: number },
  viewportWidth: number,
  viewportHeight: number,
): { width: number, height: number } => {
  let width = size.width;
  let height = size.height;
  if (width > viewportWidth) {
    width = viewportWidth;
    height = (viewportWidth / size.width) * size.height;
  }
  if (height > viewportHeight) {
    height = viewportHeight;
    width = (viewportHeight / size.height) * size.width;
  }
  return { width, height };
};

// Where the square rendition sits within the fitted original, in the fitted
// frame's pixels - the same placement the gallery's expanding photo gives its
// crop layer.
const cropRectWithin = (
  geometry: PhotoGeometry,
  imageWidth: number,
): { left: number, top: number, width: number, height: number } => {
  const scale = imageWidth / geometry.width;
  const minDim = Math.min(geometry.width, geometry.height);
  return {
    left: geometry.crop_left * scale,
    top: geometry.crop_top * scale,
    width: minDim * scale,
    height: minDim * scale,
  };
};

const FitWithinScreenImage = ({
  source,
  cropUri,
  blurhash,
  isGif,
  player,
  animatedStyle,
  onUpdateImageSize,
  geometry,
  viewport,
}: {
  source: { uri: string };
  cropUri: string | null;
  blurhash: string | null;
  isGif: boolean;
  player: VideoPlayer | null;
  animatedStyle: AnimatedStyle<ViewStyle>;
  onUpdateImageSize: (size: { imageWidth: number, imageHeight: number }) => void;
  geometry?: PhotoGeometry;
  viewport: { width: number, height: number };
}) => {
  const isFetchingSize = useRef(false);
  const [fetchedSize, setFetchedSize] = useState({width: 0, height: 0});
  const imageSize = geometry ?? fetchedSize;
  const { width: viewportWidth, height: viewportHeight } = viewport;

  const fit = imageSize.width && imageSize.height
    ? fitWithin(imageSize, viewportWidth, viewportHeight)
    : null;
  const imageWidth = fit?.width ?? null;
  const imageHeight = fit?.height ?? null;

  // On a slow connection the original can take long enough that a correctly
  // sized but still-empty photo reads as broken; the spinner says it's
  // loading. It waits out a grace period so a cache hit shows no spinner
  // flash.
  const [originalLoaded, setOriginalLoaded] = useState(false);
  const [spinnerDelayElapsed, setSpinnerDelayElapsed] = useState(false);

  const onOriginalLoad = useCallback(() => setOriginalLoaded(true), []);

  useEffect(() => {
    const timeout = setTimeout(() => setSpinnerDelayElapsed(true), 500);
    return () => clearTimeout(timeout);
  }, []);

  const showSpinner = spinnerDelayElapsed && !originalLoaded;

  useEffect(() => {
    if (geometry || isFetchingSize.current) {
      return;
    }

    isFetchingSize.current = true;
    Image.getSize(source.uri, (width, height) => {
      setFetchedSize({width, height});
      isFetchingSize.current = false;
    });
  }, [source.uri, geometry?.width, geometry?.height]);

  useEffect(() => {
    if (imageWidth === null || imageHeight === null) return;

    onUpdateImageSize({imageWidth, imageHeight});
  }, [imageWidth, imageHeight]);

  const spinner = showSpinner && (
    <View style={styles.spinnerOverlay} pointerEvents="none">
      <ActivityIndicator size="large" color="white"/>
    </View>
  );

  if (imageWidth && imageHeight && isGif) {
    return (
      <Animated.View
        style={[
          animatedStyle,
          { width: imageWidth, height: imageHeight, overflow: 'hidden' },
        ]}
      >
        <FillImage
          uri={source.uri}
          blurhash={blurhash}
          onLoad={onOriginalLoad}
        />
        {spinner}
      </Animated.View>
    );
  }

  if (imageWidth && imageHeight) {
    return (
      <Animated.View
        style={[
          animatedStyle,
          { width: imageWidth, height: imageHeight, overflow: 'hidden' },
        ]}
      >
        {/*
          The square rendition - usually cached from the profile - and its
          blurhash under it, sitting exactly where the crop lines up within
          the original, so there's a photo to show while the original
          downloads. The original covers them when it arrives.
        */}
        {geometry && cropUri && !originalLoaded &&
          <View
            style={[styles.crop, cropRectWithin(geometry, imageWidth)]}
          >
            <FillImage uri={cropUri} blurhash={blurhash} />
          </View>
        }
        <FillImage uri={source.uri} onLoad={onOriginalLoad} />
        {player &&
          <VideoSurface player={player} contentFit="contain" />
        }
        {spinner}
      </Animated.View>
    );
  }

  return <LogoActivityIndicator size="large" color="white"/>;
};

// Where the user has pinched and panned the photo to. Owned by the caller
// rather than in here, because closing the gallery has to animate the photo out
// from wherever the zoom left it - starting from anywhere else is the jump.
type PinchyZoom = {
  scale: SharedValue<number>
  translateX: SharedValue<number>
  translateY: SharedValue<number>
};

// The screen-space offset of a drag-to-dismiss in progress. Owned by the caller
// so it can carry the same offset into the closing animation - and fade its
// backdrop by how far the photo has been dragged.
type PinchyDismiss = {
  x: SharedValue<number>
  y: SharedValue<number>
};

// The horizontal pager this photo sits in. A sideways drag on the zoomed-out
// photo drives `scrollX` (settled at `index * width`); crossing the threshold
// fires `onNavigate`, which the caller uses to slide to the neighbour.
type PinchyPage = {
  scrollX: SharedValue<number>
  index: number
  width: number
  count: number
  // Whether the most recent drag ended in a page navigation, in which case
  // the next sideways drag never dismisses - it carries the photo but snaps
  // back on release.
  justNavigated: SharedValue<boolean>
};

const Pinchy = ({uuid, extraExts, blurhash, geometry, viewport, zoom, dismiss, onDismiss, page, onNavigate, onTapEdge, backgroundColor = 'black', isActive = true, underMorph = false}: {
  uuid: string,
  extraExts: string[],
  blurhash?: string | null,
  geometry?: PhotoGeometry,
  // The box to fit the photo within and centre it in.
  viewport: { width: number, height: number },
  zoom: PinchyZoom,
  // When provided, a single-finger drag on the zoomed-out photo moves it by
  // this offset, and `onDismiss` fires if it's dragged past the threshold.
  dismiss?: PinchyDismiss,
  onDismiss?: () => void,
  // When provided, a sideways drag toward a neighbouring photo pages to it
  // instead of dismissing; a sideways drag past either end of the album still
  // dismisses, unless the drag before it paged, in which case it snaps back.
  page?: PinchyPage,
  onNavigate?: (dir: number) => void,
  // When provided, a tap on the left or right third of the viewport pages to
  // the neighbour. A gesture rather than overlay views, which would swallow
  // the pan and double-tap wherever they sat.
  onTapEdge?: (dir: number) => void,
  backgroundColor?: string,
  isActive?: boolean,
  underMorph?: boolean,
}) => {
  const {
    width: viewportWidth,
    height: viewportHeight,
  } = viewport;

  const video = videoUri(uuid, extraExts);
  const [paused, setPaused] = useState(false);
  const player = useSharedVideo(isActive ? video : null, !paused, !useVideoMuted());

  const showsMedia = !(video && underMorph);

  const { controlsVisible, holdControls, pointerProps } =
    useControlsVisibility(!paused);

  if (!isActive && paused) {
    setPaused(false);
  }

  const {
    scale,
    translateX: positionX,
    translateY: positionY,
  } = zoom;

  const pinchBaseScale = useSharedValue(1);
  const panBaseX = useSharedValue(0);
  const panBaseY = useSharedValue(0);

  // A single-finger drag on the zoomed-out photo either dismisses (vertical) or
  // pages (horizontal). `dragMode` is locked once the drag picks a direction:
  // 'pan' zoomed in, else 'none' until it commits to 'dismiss', 'page', or
  // 'guardedDismiss' - a dismiss drag that snaps back instead of completing.
  const dragMode = useSharedValue<
    'none' | 'pan' | 'dismiss' | 'page' | 'guardedDismiss'
  >('none');
  const dismissBaseX = useSharedValue(0);
  const dismissBaseY = useSharedValue(0);
  const pageBaseX = useSharedValue(0);

  // The scale, position and finger focal point captured when a pinch begins, so
  // each update can keep the point that was under the fingers under them still.
  const pinchBaseX = useSharedValue(0);
  const pinchBaseY = useSharedValue(0);
  const focalBaseX = useSharedValue(0);
  const focalBaseY = useSharedValue(0);

  const imageWidth = useSharedValue(0);
  const imageHeight = useSharedValue(0);
  const viewportWidthSv = useSharedValue(viewportWidth);
  const viewportHeightSv = useSharedValue(viewportHeight);

  useEffect(() => {
    runOnUI((vw: number, vh: number) => {
      'worklet';
      viewportWidthSv.set(vw);
      viewportHeightSv.set(vh);
      const newPos = constrainPosition(
        scale.value,
        imageWidth.value,
        imageHeight.value,
        vw,
        vh,
        positionX.value,
        positionY.value,
      );
      positionX.set(newPos.x);
      positionY.set(newPos.y);
    })(viewportWidth, viewportHeight);
  }, [viewportWidth, viewportHeight, scale, positionX, positionY]);

  const onUpdateImageSize = useCallback(
    ({ imageWidth: w, imageHeight: h }: { imageWidth: number, imageHeight: number }) => {
      imageWidth.set(w);
      imageHeight.set(h);
    },
    [imageWidth, imageHeight],
  );

  const pinch = useMemo(
    () => Gesture.Pinch()
      .onStart((e) => {
        'worklet';
        pinchBaseScale.set(scale.value);
        pinchBaseX.set(positionX.value);
        pinchBaseY.set(positionY.value);
        focalBaseX.set(e.focalX);
        focalBaseY.set(e.focalY);
      })
      .onUpdate((e) => {
        'worklet';
        const newScale = Math.max(1, e.scale * pinchBaseScale.value);

        const target = focalZoomPosition(
          pinchBaseScale.value,
          newScale,
          { x: pinchBaseX.value, y: pinchBaseY.value },
          { x: focalBaseX.value, y: focalBaseY.value },
          { x: e.focalX, y: e.focalY },
          viewportWidthSv.value,
          viewportHeightSv.value,
        );

        const newPos = constrainPosition(
          newScale,
          imageWidth.value,
          imageHeight.value,
          viewportWidthSv.value,
          viewportHeightSv.value,
          target.x,
          target.y,
        );
        scale.set(newScale);
        positionX.set(newPos.x);
        positionY.set(newPos.y);
      }),
    [scale, positionX, positionY],
  );

  const pan = useMemo(
    () => Gesture.Pan()
      .manualActivation(true)
      .onTouchesMove((e, stateManager) => {
        'worklet';
        // Activate the moment a second finger is down - even before the pinch
        // grows the scale past 1 - so pan tracks the touch from the start of
        // the gesture; activating mid-gesture makes the finger lift jump the
        // image. A single finger pans once zoomed, or drags to dismiss/page
        // when zoomed out.
        if (
          e.numberOfTouches > 1 ||
          scale.value > 1 + 1e-5 ||
          dismiss !== undefined ||
          page !== undefined
        ) {
          stateManager.activate();
        } else {
          stateManager.fail();
        }
      })
      .onStart((e) => {
        'worklet';
        // Zoomed in, or a pinch: pan the image. Zoomed out with a single
        // finger: wait for the drag to reveal its direction (dismiss/page).
        const panning = scale.value > 1 + 1e-5 || e.numberOfPointers > 1;
        dragMode.set(panning ? 'pan' : 'none');

        panBaseX.set(positionX.value);
        panBaseY.set(positionY.value);
        dismissBaseX.set(dismiss?.x.value ?? 0);
        dismissBaseY.set(dismiss?.y.value ?? 0);
        pageBaseX.set(page?.scrollX.value ?? 0);
      })
      .onUpdate((e) => {
        'worklet';
        if (dragMode.value === 'pan') {
          const newPos = constrainPosition(
            scale.value,
            imageWidth.value,
            imageHeight.value,
            viewportWidthSv.value,
            viewportHeightSv.value,
            panBaseX.value,
            panBaseY.value,
            e.translationX,
            e.translationY,
          );
          positionX.set(newPos.x);
          positionY.set(newPos.y);
          return;
        }

        const moved = Math.max(Math.abs(e.translationX), Math.abs(e.translationY));

        // Lock to whichever axis the drag commits to first.
        if (dragMode.value === 'none' && moved > 8) {
          dragMode.set(lockedDragMode(
            Math.abs(e.translationX) >= Math.abs(e.translationY),
            e.translationX,
            page?.index ?? 0,
            page?.count ?? 0,
            dismiss !== undefined,
            page?.justNavigated.value ?? false,
          ));
        }

        const mode = dragMode.value;

        if (mode === 'page' && page) {
          const max = (page.count - 1) * page.width;
          page.scrollX.set(Math.min(max, Math.max(0, pageBaseX.value - e.translationX)));
        } else if ((mode === 'dismiss' || mode === 'guardedDismiss') && dismiss) {
          dismiss.x.set(dismissBaseX.value + e.translationX);
          dismiss.y.set(dismissBaseY.value + e.translationY);
        }
      })
      .onEnd((e) => {
        'worklet';
        if (page && dragMode.value !== 'none') {
          page.justNavigated.set(false);
        }

        const endPageDrag = () => {
          if (!page) return;

          const dir = pageNavDirection(
            e.translationX, e.velocityX,
            NAV_THRESHOLD, NAV_FLING_VELOCITY,
            page.index, page.count,
          );

          if (dir !== 0 && onNavigate) {
            page.justNavigated.set(true);
            runOnJS(onNavigate)(dir);
            return;
          }

          page.scrollX.set(withTiming(page.index * page.width, DISMISS_RETURN));
        };

        const endDismissDrag = () => {
          if (!dismiss) return;

          const dragged = dragDistance(dismiss.x.value, dismiss.y.value);

          const canComplete = dragMode.value === 'dismiss';

          if (canComplete && dragged > DISMISS_THRESHOLD && onDismiss) {
            runOnJS(onDismiss)();
            return;
          }

          dismiss.x.set(withTiming(0, DISMISS_RETURN));
          dismiss.y.set(withTiming(0, DISMISS_RETURN));
        };

        if (dragMode.value === 'page') endPageDrag();
        if (dragMode.value === 'dismiss' || dragMode.value === 'guardedDismiss') {
          endDismissDrag();
        }
      }),
    [dismiss, onDismiss, page, onNavigate, scale, positionX, positionY],
  );

  const doubleTap = useMemo(
    () => Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(300)
      .maxDistance(10)
      .onEnd((e, success) => {
        'worklet';
        if (!success) return;
        const isZoomed = scale.value > 1 + 1e-5;
        if (isZoomed) {
          scale.set(withTiming(1, ZOOM_TIMING));
          positionX.set(withTiming(0, ZOOM_TIMING));
          positionY.set(withTiming(0, ZOOM_TIMING));
        } else {
          const offsetX = imageWidth.value / 2 - e.x;
          const offsetY = imageHeight.value / 2 - e.y;
          const newPos = constrainPosition(
            2,
            imageWidth.value,
            imageHeight.value,
            viewportWidthSv.value,
            viewportHeightSv.value,
            offsetX,
            offsetY,
          );
          scale.set(withTiming(2, ZOOM_TIMING));
          positionX.set(withTiming(newPos.x, ZOOM_TIMING));
          positionY.set(withTiming(newPos.y, ZOOM_TIMING));
        }
      }),
    [scale, positionX, positionY],
  );

  const edgeTap = useMemo(
    () => Gesture.Tap()
      .maxDuration(300)
      .maxDistance(10)
      .onEnd((e, success) => {
        'worklet';
        if (!success) return;
        const width = viewportWidthSv.value;
        const dir = e.x < width / 3 ? -1 : e.x > width * 2 / 3 ? 1 : 0;
        if (dir !== 0 && onTapEdge) runOnJS(onTapEdge)(dir);
        else if (video) runOnJS(unmuteVideos)();
      }),
    [onTapEdge, video],
  );

  const composed = useMemo(
    // Exclusive so a double-tap zooms without also paging: the edge tap only
    // activates once the double-tap window has passed.
    () => video
      ? Gesture.Simultaneous(pan, edgeTap)
      : Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, edgeTap)),
    [pinch, pan, doubleTap, edgeTap, video],
  );

  const animatedStyle = useAnimatedStyle<ViewStyle>(() => {
    const dismissX = dismiss ? dismiss.x.value : 0;
    const dismissY = dismiss ? dismiss.y.value : 0;

    return {
      borderRadius: dragDismissRadius(dismissX, dismissY),
      // The dismiss drag translates the whole photo in screen space, so it goes
      // outermost (ahead of the zoom scale, which it must not be multiplied by).
      transform: [
        { translateX: dismissX },
        { translateY: dismissY },
        { scale: scale.value },
        { translateX: positionX.value },
        { translateY: positionY.value },
      ],
    };
  });

  return (
    <View style={StyleSheet.absoluteFill} {...pointerProps}>
      <GestureDetector gesture={composed}>
        <View style={[styles.container, { backgroundColor }]}>
          <View style={[StyleSheet.absoluteFill, styles.media, !showsMedia && styles.hidden]}>
            <FitWithinScreenImage
              source={{ uri: photoUri(uuid, 'original', extraExts) }}
              cropUri={hasGifExtraExt(extraExts) ? null : photoUri(uuid, 900)}
              blurhash={blurhash ?? null}
              isGif={hasGifExtraExt(extraExts)}
              player={showsMedia ? player : null}
              animatedStyle={animatedStyle}
              onUpdateImageSize={onUpdateImageSize}
              geometry={geometry}
              viewport={{ width: viewportWidth, height: viewportHeight }}
            />
          </View>
        </View>
      </GestureDetector>
      {video && isActive && player &&
        <VideoControls
          player={player}
          playing={!paused}
          onTogglePlaying={() => setPaused((paused) => !paused)}
          visible={controlsVisible}
          onHoverChange={holdControls}
          style={styles.controls}
        />
      }
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    zIndex: 999,
    // @ts-ignore
    touchAction: 'none',
  },
  crop: {
    position: 'absolute',
  },
  spinnerOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  controls: {
    zIndex: 1000,
  },
  media: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  hidden: {
    opacity: 0,
  },
});

export {
  Pinchy,
};

export type {
  PinchyDismiss,
  PinchyPage,
  PinchyZoom,
};
