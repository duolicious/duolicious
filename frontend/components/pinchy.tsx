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
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { IMAGES_URL } from '../env/env';
import { constrainPosition, focalZoomPosition } from './pinchy-math';

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

const Pinchy = ({uuid, naturalSize, viewport, zoom, backgroundColor = 'black'}: {
  uuid: string,
  naturalSize?: { width: number, height: number },
  // The box to fit the photo within and centre it in. Defaults to the window,
  // which is only the same thing when this fills the screen.
  viewport?: { width: number, height: number },
  zoom: PinchyZoom,
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
        // centroid mid-gesture, and the lift jumps the image instead. Also
        // activate for a single finger once zoomed, so you can pan around.
        if (e.numberOfTouches > 1 || scale.value > 1 + 1e-5) {
          stateManager.activate();
        } else {
          // A single finger on an unzoomed image isn't a pan; let it through.
          stateManager.fail();
        }
      })
      .onStart(() => {
        'worklet';
        panBaseX.value = positionX.value;
        panBaseY.value = positionY.value;
      })
      .onUpdate((e) => {
        'worklet';
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
      }),
    [],
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
          scale.value = 1;
          positionX.value = 0;
          positionY.value = 0;
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
          scale.value = 2;
          positionX.value = newPos.x;
          positionY.value = newPos.y;
        }
      }),
    [],
  );

  const composed = useMemo(
    () => Gesture.Simultaneous(pinch, pan, doubleTap),
    [pinch, pan, doubleTap],
  );

  const animatedStyle = useAnimatedStyle<ImageStyle>(() => ({
    transform: [
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
  PinchyZoom,
};
