import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Image,
  ImageStyle,
  StyleSheet,
  View,
  useWindowDimensions,
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
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { IMAGES_URL } from '../env/env';
import { constrainPosition, focalZoomPosition } from './pinchy-math';

// Double-tap zoom eases in rather than snapping. A pinch or pan writing the
// shared values directly cancels it mid-flight, which is what you want.
const ZOOM_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) };

// Dragging the zoomed-out photo at least this far (screen px) before lifting
// dismisses the gallery; a shorter drag springs the photo back to centre.
const DISMISS_THRESHOLD = 110;

const DISMISS_SPRING = { damping: 22, stiffness: 220 };

const FitWithinScreenImage = ({
  source,
  animatedStyle,
  onUpdateImageSize,
  naturalSize,
  viewport,
}: {
  source: { uri: string };
  animatedStyle: AnimatedStyle<ImageStyle>;
  onUpdateImageSize: (size: { imageWidth: number, imageHeight: number }) => void;
  naturalSize?: { width: number, height: number };
  viewport: { width: number, height: number };
}) => {
  const isFetchingSize = useRef(false);
  const [imageSize, setImageSize] = useState(
    naturalSize ?? {width: 0, height: 0},
  );
  const [imageWidth, setImageWidth] = useState<number | null>(null);
  const [imageHeight, setImageHeight] = useState<number | null>(null);
  const { width: viewportWidth, height: viewportHeight } = viewport;

  useEffect(() => {
    // Callers that already know the photo's dimensions (the API reports them)
    // save the round trip, and with it the spinner that would otherwise appear
    // for a frame in place of an image the caller has already drawn.
    if (naturalSize) {
      setImageSize(naturalSize);
      return;
    }

    if (isFetchingSize.current) {
      return;
    }

    isFetchingSize.current = true;
    Image.getSize(source.uri, (width, height) => {
      setImageSize({width, height});
      isFetchingSize.current = false;
    });
  }, [source.uri, naturalSize?.width, naturalSize?.height]);

  useEffect(() => {
    let newWidth = imageSize.width;
    let newHeight = imageSize.height;

    if (imageSize.width > viewportWidth) {
      newWidth = viewportWidth;
      newHeight = (viewportWidth / imageSize.width) * imageSize.height;
    }

    if (newHeight > viewportHeight) {
      newHeight = viewportHeight;
      newWidth = (viewportHeight / imageSize.height) * imageSize.width;
    }

    setImageWidth(newWidth);
    setImageHeight(newHeight);

    onUpdateImageSize({imageWidth: newWidth, imageHeight: newHeight});
  }, [
    imageSize.width,
    imageSize.height,
    viewportWidth,
    viewportHeight
  ]);

  if (imageWidth && imageHeight) {
    return (
      <Animated.Image
        source={source}
        style={[animatedStyle, { width: imageWidth, height: imageHeight }]}
        resizeMode="contain"
      />
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

const Pinchy = ({uuid, naturalSize, viewport, zoom, dismiss, onDismiss, backgroundColor = 'black'}: {
  uuid: string,
  naturalSize?: { width: number, height: number },
  // The box to fit the photo within and centre it in. Defaults to the window,
  // which is only the same thing when this fills the screen.
  viewport?: { width: number, height: number },
  zoom: PinchyZoom,
  // When provided, a single-finger drag on the zoomed-out photo moves it by
  // this offset, and `onDismiss` fires if it's dragged past the threshold.
  dismiss?: PinchyDismiss,
  onDismiss?: () => void,
  backgroundColor?: string,
}) => {
  const window = useWindowDimensions();

  const {
    width: viewportWidth,
    height: viewportHeight,
  } = viewport ?? window;

  const {
    scale,
    translateX: positionX,
    translateY: positionY,
  } = zoom;

  const pinchBaseScale = useSharedValue(1);
  const panBaseX = useSharedValue(0);
  const panBaseY = useSharedValue(0);

  // A single-finger drag on the zoomed-out photo is a drag-to-dismiss rather
  // than a pan; this records that, and where the drag started from.
  const isDismissing = useSharedValue(false);
  const dismissBaseX = useSharedValue(0);
  const dismissBaseY = useSharedValue(0);

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
      viewportWidthSv.value = vw;
      viewportHeightSv.value = vh;
      const newPos = constrainPosition(
        scale.value,
        imageWidth.value,
        imageHeight.value,
        vw,
        vh,
        positionX.value,
        positionY.value,
      );
      positionX.value = newPos.x;
      positionY.value = newPos.y;
    })(viewportWidth, viewportHeight);
  }, [viewportWidth, viewportHeight]);

  const onUpdateImageSize = useCallback(
    ({ imageWidth: w, imageHeight: h }: { imageWidth: number, imageHeight: number }) => {
      imageWidth.value = w;
      imageHeight.value = h;
    },
    [imageWidth, imageHeight],
  );

  const pinch = useMemo(
    () => Gesture.Pinch()
      .onStart((e) => {
        'worklet';
        pinchBaseScale.value = scale.value;
        pinchBaseX.value = positionX.value;
        pinchBaseY.value = positionY.value;
        focalBaseX.value = e.focalX;
        focalBaseY.value = e.focalY;
      })
      .onUpdate((e) => {
        'worklet';
        const newScale = Math.max(1, e.scale * pinchBaseScale.value);

        // Zoom towards the fingers rather than the middle of the photo.
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
        scale.value = newScale;
        positionX.value = newPos.x;
        positionY.value = newPos.y;
      }),
    [],
  );

  const pan = useMemo(
    () => Gesture.Pan()
      .manualActivation(true)
      .onTouchesMove((e, stateManager) => {
        'worklet';
        // Activate the moment a second finger is down - i.e. a pinch - even
        // before it has grown the scale past 1, so pan tracks the touch from
        // the start of the gesture. React Native Gesture Handler then smooths
        // out the discontinuity when a finger lifts; a pan that only activates
        // partway through (once the pinch crosses scale 1) starts tracking the
        // centroid mid-gesture, and the lift jumps the image instead. A single
        // finger pans once zoomed, or drags to dismiss when zoomed out.
        if (
          e.numberOfTouches > 1 ||
          scale.value > 1 + 1e-5 ||
          dismiss !== undefined
        ) {
          stateManager.activate();
        } else {
          stateManager.fail();
        }
      })
      .onStart((e) => {
        'worklet';
        // A single finger on the zoomed-out photo drags to dismiss; anything
        // else (a pinch, or a drag while zoomed in) pans.
        isDismissing.value =
          dismiss !== undefined &&
          e.numberOfPointers <= 1 &&
          scale.value <= 1 + 1e-5;

        if (isDismissing.value && dismiss) {
          dismissBaseX.value = dismiss.x.value;
          dismissBaseY.value = dismiss.y.value;
        } else {
          panBaseX.value = positionX.value;
          panBaseY.value = positionY.value;
        }
      })
      .onUpdate((e) => {
        'worklet';
        if (isDismissing.value && dismiss) {
          dismiss.x.value = dismissBaseX.value + e.translationX;
          dismiss.y.value = dismissBaseY.value + e.translationY;
          return;
        }

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
        positionX.value = newPos.x;
        positionY.value = newPos.y;
      })
      .onEnd(() => {
        'worklet';
        if (!isDismissing.value || !dismiss) {
          return;
        }

        const dragged = Math.sqrt(
          dismiss.x.value ** 2 + dismiss.y.value ** 2,
        );

        if (dragged > DISMISS_THRESHOLD && onDismiss) {
          runOnJS(onDismiss)();
        } else {
          // Didn't drag far enough - spring back to centre.
          dismiss.x.value = withSpring(0, DISMISS_SPRING);
          dismiss.y.value = withSpring(0, DISMISS_SPRING);
        }
      }),
    [dismiss, onDismiss],
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
          scale.value = withTiming(1, ZOOM_TIMING);
          positionX.value = withTiming(0, ZOOM_TIMING);
          positionY.value = withTiming(0, ZOOM_TIMING);
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
          scale.value = withTiming(2, ZOOM_TIMING);
          positionX.value = withTiming(newPos.x, ZOOM_TIMING);
          positionY.value = withTiming(newPos.y, ZOOM_TIMING);
        }
      }),
    [],
  );

  const composed = useMemo(
    () => Gesture.Simultaneous(pinch, pan, doubleTap),
    [pinch, pan, doubleTap],
  );

  const animatedStyle = useAnimatedStyle<ImageStyle>(() => ({
    // The dismiss drag translates the whole photo in screen space, so it goes
    // outermost (ahead of the zoom scale, which it must not be multiplied by).
    transform: [
      { translateX: dismiss ? dismiss.x.value : 0 },
      { translateY: dismiss ? dismiss.y.value : 0 },
      { scale: scale.value },
      { translateX: positionX.value },
      { translateY: positionY.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <View style={[styles.container, { backgroundColor }]}>
        <FitWithinScreenImage
          source={{ uri: `${IMAGES_URL}/original-${uuid}.jpg` }}
          animatedStyle={animatedStyle}
          onUpdateImageSize={onUpdateImageSize}
          naturalSize={naturalSize}
          viewport={{ width: viewportWidth, height: viewportHeight }}
        />
      </View>
    </GestureDetector>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    zIndex: 999,
    // @ts-ignore
    touchAction: 'none',
  },
});

export {
  Pinchy,
};

export type {
  PinchyDismiss,
  PinchyZoom,
};
