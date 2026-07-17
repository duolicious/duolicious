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
import { IMAGES_URL } from '../env/env';

const constrainPosition = (
  currentScale: number,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  x: number,
  y: number,
  dx: number = 0,
  dy: number = 0,
) => {
  'worklet';
  const adjustedWidth = imageWidth * currentScale;
  const adjustedHeight = imageHeight * currentScale;

  const maxTranslateX = (adjustedWidth > viewportWidth) ?
    (adjustedWidth - viewportWidth) / 2 / currentScale :
    (viewportWidth - adjustedWidth) / 2 / currentScale;

  const maxTranslateY = (adjustedHeight > viewportHeight) ?
    (adjustedHeight - viewportHeight) / 2 / currentScale :
    (viewportHeight - adjustedHeight) / 2 / currentScale;

  return {
    x: (adjustedWidth > viewportWidth) ?
       Math.min(maxTranslateX, Math.max(-maxTranslateX, x + dx / currentScale)) :
       0,
    y: (adjustedHeight > viewportHeight) ?
       Math.min(maxTranslateY, Math.max(-maxTranslateY, y + dy / currentScale)) :
       0,
  };
};

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

const Pinchy = ({uuid, naturalSize, viewport, backgroundColor = 'black'}: {
  uuid: string,
  naturalSize?: { width: number, height: number },
  // The box to fit the photo within and centre it in. Defaults to the window,
  // which is only the same thing when this fills the screen.
  viewport?: { width: number, height: number },
  backgroundColor?: string,
}) => {
  const window = useWindowDimensions();

  const {
    width: viewportWidth,
    height: viewportHeight,
  } = viewport ?? window;

  const scale = useSharedValue(1);
  const positionX = useSharedValue(0);
  const positionY = useSharedValue(0);

  const pinchBaseScale = useSharedValue(1);
  const panBaseX = useSharedValue(0);
  const panBaseY = useSharedValue(0);

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
      .onStart(() => {
        'worklet';
        pinchBaseScale.value = scale.value;
      })
      .onUpdate((e) => {
        'worklet';
        const newScale = Math.max(1, e.scale * pinchBaseScale.value);
        const newPos = constrainPosition(
          newScale,
          imageWidth.value,
          imageHeight.value,
          viewportWidthSv.value,
          viewportHeightSv.value,
          positionX.value,
          positionY.value,
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
      .onTouchesMove((_e, stateManager) => {
        'worklet';
        if (scale.value > 1 + 1e-5) {
          stateManager.activate();
        } else {
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
  Pinchy
};
