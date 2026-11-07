import {
  Animated,
  BackHandler,
  GestureResponderEvent,
  Image,
  PanResponder,
  PanResponderGestureState,
  Platform,
  StatusBar,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DefaultText } from './default-text';
import { listen, notify } from '../events/events';
import { ModalButton } from './button/modal';

const buttonHeight = 110; // Define the height for the button

type ImageCropperInput = {
  base64: string
  height: number
  width: number
  outputEventName: string
  fileNumber: number
  showProtip?: boolean
};

type ImageCropperOutput = {
  [fileNumber: number]: {
    originalBase64: string
    top: number
    left: number
    size: number
  } | null
};

type NonNullImageCropperOutput = Exclude<ImageCropperOutput[number], null>;

const ImageCropper = () => {
  const [data, setData] = useState<ImageCropperInput>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const imageSource = useMemo(() => ({uri: data?.base64}), [data?.base64]);

  const cropAreaBase = useRef<
    {top: number, left: number, size: number} | null
  >(null);
  const cropArea = useRef({ top: 0, left: 0, size: 0 });
  const [animatedCropArea] = useState(() => ({
    top: new Animated.Value(0),
    left: new Animated.Value(0),
    right: new Animated.Value(0),
    bottom: new Animated.Value(0),
    size: new Animated.Value(0),
  }));

  const setCropArea = (p: {top: number, left: number, size: number}) => {
    cropArea.current = p;

    animatedCropArea.top.setValue(p.top);
    animatedCropArea.bottom.setValue(p.top + p.size);
    animatedCropArea.left.setValue(p.left);
    animatedCropArea.right.setValue(p.left + p.size);
    animatedCropArea.size.setValue(p.size);
  };

  const computeRenderedImageSize = () => {
    if (!data) {
      return null;
    }

    const aspectRatio = data.width / data.height;

    const availableWidth = windowWidth - insets.left - insets.right;
    const availableHeight =
      windowHeight - insets.top - insets.bottom - buttonHeight;

    let newWidth: number;
    let newHeight: number;

    if (availableWidth / availableHeight < aspectRatio) {
      newWidth = availableWidth;
      newHeight = availableWidth / aspectRatio;
    } else {
      newWidth = availableHeight * aspectRatio;
      newHeight = availableHeight;
    }

    return { width: newWidth, height: newHeight };
  };

  const renderedImageSize = computeRenderedImageSize();
  const renderedImageSizeRef = useRef(renderedImageSize);
  useLayoutEffect(() => {
    renderedImageSizeRef.current = renderedImageSize;
  });

  const onPanResponderMove = (event: GestureResponderEvent, gestureState: PanResponderGestureState) => {
    const renderedImageSize = renderedImageSizeRef.current;

    if (!renderedImageSize) {
      return;
    }

    if (cropAreaBase.current === null) {
      cropAreaBase.current = {
        top: cropArea.current.top,
        left: cropArea.current.left,
        size: cropArea.current.size,
      };
    }

    let newTop = cropAreaBase.current.top + gestureState.dy;
    let newLeft = cropAreaBase.current.left + gestureState.dx;

    // Bounds checking
    newTop = Math.max(0, newTop);
    newLeft = Math.max(0, newLeft);
    const maxTop = renderedImageSize.height - cropAreaBase.current.size;
    const maxLeft = renderedImageSize.width - cropAreaBase.current.size;
    newTop = Math.min(maxTop, newTop);
    newLeft = Math.min(maxLeft, newLeft);

    setCropArea({top: newTop, left: newLeft, size: cropAreaBase.current.size});
  };

  const onPressEnd = () => {
    cropAreaBase.current = null;
  };

  // eslint-disable-next-line react-hooks/refs
  const [panResponder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove,
      onPanResponderRelease: onPressEnd,
      onPanResponderTerminate: onPressEnd,
    })
  );

  const renderedWidth = renderedImageSize?.width;
  const renderedHeight = renderedImageSize?.height;

  useEffect(() => {
    if (renderedWidth === undefined || renderedHeight === undefined) {
      return;
    }

    const cropSize = Math.min(renderedWidth, renderedHeight);

    setCropArea({
      top: (renderedHeight - cropSize) / 2,
      left: (renderedWidth - cropSize) / 2,
      size: cropSize
    });
  }, [data, renderedWidth, renderedHeight]);

  useEffect(() => {
    return listen<ImageCropperInput>(
      'image-cropper-open',
      (data) => setData(data)
    );
  }, []);

  const onCancelPress = () => {
    if (!data) {
      return true;
    }

    notify<ImageCropperOutput>(
      data.outputEventName,
      {
        [data.fileNumber]: null
      }
    );

    setData(undefined);

    return true;
  };

  const onCropPress = async () => {
    if (!data) {
      return;
    }

    if (!renderedImageSize) {
      return;
    }

    const realCropArea = {
      top: data.height / renderedImageSize.height * cropArea.current.top,
      left: data.width / renderedImageSize.width * cropArea.current.left,
      size: Math.min(data.height, data.width),
    };

    notify<ImageCropperOutput>(
      data.outputEventName,
      {
        [data.fileNumber]: {
          originalBase64: data.base64,
          top:  Math.round(realCropArea.top),
          left: Math.round(realCropArea.left),
          size: realCropArea.size,
        }
      }
    );

    setData(undefined);
  };

  useEffect(() => {
    if (!data) {
      return;
    }

    if (Platform.OS !== 'ios') {
      return;
    }

    const pushed = StatusBar.pushStackEntry({ hidden: true });
    return () => StatusBar.popStackEntry(pushed);
  }, []);

  useEffect(() => {
    if (!data) {
      return;
    }

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      onCancelPress,
    );

    return () => subscription.remove();
  }, [data]);

  if (!data) {
    return null;
  }

  return (
    <View style={[
      styles.container,
      {
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      },
    ]}>
      <View style={{
        width:  renderedImageSize?.width ?? 0,
        height: renderedImageSize?.height ?? 0,
        backgroundColor: 'black'
      }}>
        <Image
          resizeMode="cover"
          source={imageSource}
          style={styles.image}
        />

        {/* Opaque overlay view - top */}
        <Animated.View style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: animatedCropArea.top,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
        }} />

        {/* Opaque overlay view - bottom */}
        <Animated.View style={{
          position: 'absolute',
          top: animatedCropArea.bottom,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
        }} />

        {/* Opaque overlay view - left */}
        <Animated.View style={{
          position: 'absolute',
          top: animatedCropArea.top,
          left: 0,
          width: animatedCropArea.left,
          height: animatedCropArea.size,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
        }} />

        {/* Opaque overlay view - right */}
        <Animated.View style={{
          position: 'absolute',
          top: animatedCropArea.top,
          left: animatedCropArea.right, // This looks wrong but it's right
          right: 0,
          height: animatedCropArea.size,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
        }} />

        {/* Crop window */}
        <Animated.View
          {...panResponder.panHandlers}
          style={{
            position: 'absolute',
            top: animatedCropArea.top,
            left: animatedCropArea.left,
            width: animatedCropArea.size,
            height: animatedCropArea.size,
            borderWidth: 1,
            borderColor: 'white',
            backgroundColor: 'transparent',
          }}
        />
      </View>
      <View style={styles.bottomContainer}>
        <View style={styles.buttonContainer}>
          <ModalButton color="#999" onPress={onCancelPress} title="Cancel" />
          <ModalButton color="#70f" onPress={onCropPress} title="Crop" />
        </View>
        {(data?.showProtip ?? true) &&
          <DefaultText style={styles.protip}>
            <DefaultText style={styles.boldProtip} disableTheme={true}>
              Pro tip: {}
            </DefaultText>
            Visitors to your profile can see the uncropped pic too
          </DefaultText>
        }
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...(Platform.OS === 'web' ? {
      touchAction: 'none',         // prevent selection on web
    } : {}),

    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'black',
  },
  pressable: {
    height: 40,
    width: 100,
  },
  defaultText: {
    color: 'white',
    fontWeight: '700',
  },
  bottomContainer: {
    height: buttonHeight,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 10,
    paddingRight: 10,
  },
  buttonContainer: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    flexDirection: 'row',
  },
  protip: {
    color: 'white',
    textAlign: 'center',
  },
  boldProtip: {
    fontWeight: '700',
  },
  image: {
    width: '100%',
    height: '100%',
  }
});

export {
  ImageCropper,
  ImageCropperInput,
  ImageCropperOutput,
  NonNullImageCropperOutput,
};
