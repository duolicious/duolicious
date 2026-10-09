import {
  Platform,
  View,
} from 'react-native';
import { LogoActivityIndicator } from '../logo/logo-activity-indicator';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome'
import { faCircleXmark } from '@fortawesome/free-solid-svg-icons/faCircleXmark'
import { notify, listen, lastEvent } from '../../events/events';
import {
  ImageCropperInput,
  ImageCropperOutput,
} from '../image-cropper';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { isImagePickerOpen } from '../../App';
import { Image as ExpoImage } from 'expo-image';
import { VerificationEvent } from '../../verification/verification';
import { VerificationBadge } from '../verification-badge';
import { DefaultText } from '../default-text';
import * as Haptics from 'expo-haptics';
import
  Animated,
  {
    SharedValue,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
  } from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import {
  OptionGroupPhotos,
} from '../../data/option-groups';
import { remap } from './logic';
import { photoQueue } from '../../api/queue';
import { japi } from '../../api/api';
import * as _ from "lodash";
import { useAppTheme } from '../../app-theme/app-theme';
import { Flair } from '../../components/badges';

// TODO: Image picker is shit and lets you upload any file type on web

const EV_IMAGES = 'images';
const EV_IMAGE_CROPPER_OUTPUT = 'image-cropper-output';
const EV_IMAGE_LOADING = 'image-loading';
const EV_IMAGE_URI = 'image-uri';
const EV_SLOTS = 'slots';
const EV_SLOT_ASSIGNMENT_FINISH = 'slot-assignment-finish';
const EV_SLOT_ASSIGNMENT_START = 'slot-assignment-start';
const EV_SLOT_REQUEST = 'slot-request';
const EV_UPDATED_NAME = 'updated-name';
const EV_UPDATED_FLAIR = 'updated-flair';
const EV_UPDATED_VERIFICATION = 'updated-verification';

type Point2D = {
  x: number
  y: number
};

type Image = {
  exists: boolean
};

type Images = {
  [k: number]: Image
};

type Slot = {
  center: Point2D
  origin: Point2D

  height: number
  width: number
};

type Slots = {
  [k: number]: Slot
};

type SlotRequest = {
  from: number
  to: number
  pressed: number | null
};

type SlotAssignmentStart = {
  from: number
  to: number
  pressed: number | null
};

type ImageLoading = {
  [k: number]: boolean
};

type ImageUri = {
  [k: number]: string | null
};

type HttpPostAssignments = {
  [k: number]: number
};

const merge = <T extends object>(old: T, extra: Partial<T> | undefined): T => {
  const updated = { ...old, ...extra };
  if (_.isEqual(old, updated)) {
    return old;
  } else {
    return updated;
  }
};

const getOccupancyMap = (images: Images): { [k: number]: boolean } => {
  return Object
    .entries(images)
    .reduce(
      (acc, [fileNumber, slot]) => {
        acc[Number(fileNumber)] = slot.exists;
        return acc;
      },
      {} as { [k: number]: boolean }
    );
};

const getNearestSlot = (slots: Slots, p: Point2D): number => {
  'worklet';

  let nearestSlot = -1;
  let nearestDistance = -1;

  for (const [fileNumber, slot] of Object.entries(slots)) {
    const p1 = p;
    const p2 = slot.center;

    const distance = (
      (p1.x - p2.x) ** 2.0 +
      (p1.y - p2.y) ** 2.0
    ) ** 0.5;

    if (nearestDistance === -1 || distance < nearestDistance) {
      nearestSlot = Number(fileNumber);
      nearestDistance = distance;
    }
  }

  return nearestSlot;
};

const getRelativeSlot = (slot: Slot, pageX: number, pageY: number): Slot => {
  return {
    center: {
      x: slot.center.x - pageX,
      y: slot.center.y - pageY,
    },
    origin: {
      x: slot.origin.x - pageX,
      y: slot.origin.y - pageY,
    },
    height: slot.height,
    width: slot.width,
  };
};

const getRelativeSlots = (slots: Slots, pageX: number, pageY: number): Slots => {
  return Object
    .entries(slots)
    .reduce(
      (acc, [fileNumber, slot]) => {
        acc[Number(fileNumber)] = getRelativeSlot(slot, pageX, pageY);

        return acc
      },
      {} as Slots
    )
};

const setIsImageLoading = (
  fileNumber: SharedValue<number>,
  isLoading: boolean,
) => {
  const isImageLoading = lastEvent<ImageLoading>(EV_IMAGE_LOADING) ?? {};

  const updatedIsImageLoading: ImageLoading = {
    ...isImageLoading,
    [fileNumber.value]: isLoading,
  };

  notify<ImageLoading>(EV_IMAGE_LOADING, updatedIsImageLoading);
};

const getIsImageLoading = (fileNumber: SharedValue<number>): boolean => {
  const isImageLoading = lastEvent<ImageLoading>(EV_IMAGE_LOADING) ?? {};

  return isImageLoading[fileNumber.value] ?? false;
};

const useIsImageLoading = (fileNumber: SharedValue<number> | number): boolean => {
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    return listen<ImageLoading>(
      EV_IMAGE_LOADING,
      (data) => {
        if (!data) {
          return;
        }

        const unpackedFileNumber =
          typeof fileNumber === 'number' ?
          fileNumber :
          fileNumber.value;

        const isLoading = data[unpackedFileNumber];

        if (isLoading === undefined) {
          return;
        }

        setIsLoading(isLoading);
      }
    );
  }, []);

  return isLoading;
};

const useUri = (
  fileNumber: SharedValue<number> | number,
  initialUri: string | null
) => {
  const [uriState, setUriState] = useState<string | null>(initialUri);
  const uriRef = useRef<string | null>(initialUri);

  useEffect(() => {
    return listen<ImageUri>(
      EV_IMAGE_URI,
      (data) => {
        if (!data) {
          return;
        }

        const unpackedFileNumber =
          typeof fileNumber === 'number' ?
          fileNumber :
          fileNumber.value;

        const uri = data[unpackedFileNumber];

        if (uri === undefined) {
          return;
        }

        setUriState(uri);
        uriRef.current = uri;
      }
    );
  }, []);

  return { uriState, uriRef };
};

const useIsVerified = (fileNumber: SharedValue<number>) => {
  const [isVerifiedState, setIsVerifiedState] = useState(false);
  const isVerifiedRef = useRef(false);

  useEffect(() => {
    return listen<VerificationEvent>(
      EV_UPDATED_VERIFICATION,
      (data) => {
        if (!data) {
          return;
        }

        if (!data.photos) {
          return;
        }

        const photoData: boolean | undefined = data.photos[fileNumber.value];

        if (photoData === undefined) {
          return;
        }

        setIsVerifiedState(photoData);
        isVerifiedRef.current = photoData;
      },
      true
    );
  }, []);

  return { isVerifiedState, isVerifiedRef };
};

const isSquareish = (width: number, height: number) => {
  if (width === 0) return true;
  if (height === 0) return true;

  const biggerDim = Math.max(width, height);
  const smallerDim = Math.min(width, height);

  return biggerDim / smallerDim < 1.1;
};

const isGif = (mimeType: string) => mimeType === 'image/gif';

const cropImage = async (
  base64: string,
  height: number,
  originX: number,
  originY: number,
  width: number,
): Promise<string> => {
  if (base64.startsWith('data:image/gif;')) {
    return base64;
  }

  const result = await manipulateAsync(
    base64,
    [{ crop: { height, originX, originY, width }}],
    {
      base64: true,
      compress: 1,
      format: SaveFormat.JPEG
    }
  );

  if (!result.base64) {
    throw Error('Unexpected output from manipulateAsync');
  }

  return `data:image/jpeg;base64,${result.base64}`;
};

const postAssignments = (photoAssignments: HttpPostAssignments) => {
  photoQueue.addTask(async () => {
    await japi(
      'PATCH',
      '/profile-info',
      { photo_assignments: photoAssignments }
    );
  });
};

const addImage = async (
  fileNumber: SharedValue<number>,
  showProtip: boolean,
) => {
  if (getIsImageLoading(fileNumber)) {
    return;
  }
  if (isImagePickerOpen.value) {
    return;
  }

  if (Platform.OS !== 'web') {
    setIsImageLoading(fileNumber, true);
    isImagePickerOpen.value = true;
  }

  // No permissions request is necessary for launching the image library
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    quality: 1,
    selectionLimit: 1,
    base64: true,
  });

  if (result.canceled && Platform.OS !== 'web') {
    isImagePickerOpen.value = false;
    setIsImageLoading(fileNumber, false);
  }
  if (result.canceled) {
    return;
  }

  const width = result.assets[0].width;
  const height = result.assets[0].height;
  const mimeType = result.assets[0].mimeType;
  const base64 = result.assets[0].base64;
  if (!width) return;
  if (!height) return;
  if (!mimeType) return;
  if (!base64) {
    console.warn('Unexpected output from launchImageLibraryAsync');
    return;
  }

  const base64Uri = `data:${mimeType};base64,${base64}`;

  setIsImageLoading(fileNumber, true);

  if (isGif(mimeType) || isSquareish(width, height)) {
    const size = Math.min(width, height);

    notify<ImageCropperOutput>(
      EV_IMAGE_CROPPER_OUTPUT,
      {
        [fileNumber.value]: {
          originalBase64: base64Uri,
          top:  Math.round((height - size) / 2),
          left: Math.round((width  - size) / 2),
          size,
        }
      }
    );
  } else {
    notify<ImageCropperInput>(
      'image-cropper-open',
      {
        base64: base64Uri,
        height,
        width,
        outputEventName: EV_IMAGE_CROPPER_OUTPUT,
        fileNumber: fileNumber.value,
        showProtip: showProtip,
      }
    );
  }
};

const useImagePickerResult = (
  input: OptionGroupPhotos,
  fileNumber: SharedValue<number>
): void => {
  useEffect(() => {
    return listen<ImageCropperOutput>(
      EV_IMAGE_CROPPER_OUTPUT,
      async (data) => {
        isImagePickerOpen.value = false;

        if (data === undefined) {
          return;
        }

        const singleData: ImageCropperOutput[number] | undefined =
          data[fileNumber.value];

        if (singleData === undefined) {
          return;
        }

        if (singleData === null) {
          ;
        } else if (await input.photos.submit(fileNumber.value, singleData)) {
          const base64 = await cropImage(
            singleData.originalBase64,
            singleData.size,
            singleData.left,
            singleData.top,
            singleData.size,
          );

          notify<ImageUri>(EV_IMAGE_URI, { [fileNumber.value]: base64 });

          notify<VerificationEvent>(
            EV_UPDATED_VERIFICATION,
            { photos: { [`${fileNumber.value}`]: false } }
          );
        }

        setIsImageLoading(fileNumber, false);
      }
    );
  }, []);
};

const removeImage = async (
  input: OptionGroupPhotos,
  fileNumber: SharedValue<number>,
) => {
  setIsImageLoading(fileNumber, true);

  const result = await photoQueue.addTask(
    async () => await input.photos.delete(String(fileNumber.value))
  );

  if (result) {
    notify<ImageUri>(EV_IMAGE_URI, { [fileNumber.value]: null });

    notify<VerificationEvent>(
      EV_UPDATED_VERIFICATION,
      { photos: { [`${fileNumber.value}`]: false } }
    );
  }

  setIsImageLoading(fileNumber, false);
};

const hapticsSelection = () => {
  if (Platform.OS !== 'web') {
    Haptics.impactAsync();
  }
};

const FileNumber = ({
  fileNumber,
  left,
  top
}: {
  fileNumber: number
  left: number
  top: number
}) => {
  const { appTheme } = useAppTheme();

  if (fileNumber < 1) {
    return null;
  }

  return (
    <View
      style={{
        position: 'absolute',
        left: left,
        top: top,
        overflow: 'visible',
      }}
    >
      <DefaultText
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          color: appTheme.secondaryColor,
          backgroundColor: appTheme.primaryColor,
          borderWidth: 1,
          borderColor: appTheme.secondaryColor,
          paddingHorizontal: 8,
          paddingVertical: 1,
          borderRadius: 999,
          fontSize: 12,
        }}
      >
        {fileNumber === 1 ? 'Main' : fileNumber}
      </DefaultText>
    </View>
  );
};

const MoveableImage = ({
  input,
  initialFileNumber,
  absolutePosition,
  slots = [],
  moveable = true,
  showProtip = true,
}: {
  input: OptionGroupPhotos
  slots?: Slots,
  initialFileNumber: number
  absolutePosition?: {
    height: number,
    width: number,
    left: number,
    top: number,
  },
  moveable?: boolean,
  showProtip?: boolean,
}) => {
  const initialUri =
    input.photos.getUri ?
    input.photos.getUri(String(initialFileNumber), '450') :
    null;

  const initialBlurhash =
    input.photos.getBlurhash ?
    input.photos.getBlurhash(String(initialFileNumber)) :
    null;

  const { appTheme } = useAppTheme();
  const fileNumber = useSharedValue(initialFileNumber);
  const _slots = useSharedValue(slots);
  const isSlotAssignmentUnfinished = useSharedValue(false);
  const isLoading = useIsImageLoading(fileNumber);
  const { uriState, uriRef } = useUri(fileNumber, initialUri);
  const { isVerifiedState, isVerifiedRef } = useIsVerified(fileNumber);

  const getBorderRadius = useCallback((fileNumber: number) => {
    'worklet';

    const {
      height = 0,
      width = 0,
    } = absolutePosition ?? {};

    return fileNumber === 1 ? Math.max(height ?? 0, width ?? 0) / 2 : 5;
  }, [absolutePosition?.height, absolutePosition?.width]);

  const [zIndex, setZIndex] = useState<number>(0);

  const initialBorderRadius = getBorderRadius(initialFileNumber);

  const translateX = useSharedValue<number>(absolutePosition?.left ?? 0);
  const translateY = useSharedValue<number>(absolutePosition?.top ?? 0);
  const scale = useSharedValue<number>(1);
  const borderRadius = useSharedValue<number>(initialBorderRadius);

  const debouncedSlotRequest =
    _.debounce(
      (data: SlotRequest) => notify<SlotRequest>(EV_SLOT_REQUEST, data),
      500,
      { maxWait: 500 },
    );

  const requestNearestSlot = (pressed: number | null) => {
    'worklet';

    const p: Point2D = {
      x:
        _slots.value[fileNumber.value].center.x -
        _slots.value[fileNumber.value].origin.x +
        translateX.value,
      y:
        _slots.value[fileNumber.value].center.y -
        _slots.value[fileNumber.value].origin.y +
        translateY.value,
    };

    const nearestSlot = getNearestSlot(_slots.value, p);

    const from = fileNumber.value;
    const to = nearestSlot;

    scheduleOnRN(debouncedSlotRequest, { from, to, pressed });
  };

  const addImageOnStart =
    () => addImage(fileNumber, showProtip);

  const removeImageOnTap =
    () => removeImage(input, fileNumber);

  const pan =
    Gesture
    .Pan()
    .activateAfterLongPress(200)
    .onStart(() => {
      scale.value = withTiming(1.1, { duration: 50 });
      scheduleOnRN(setZIndex, 1);
      scheduleOnRN(hapticsSelection);
    })
    .onChange((event) => {
      translateX.value += event.changeX;
      translateY.value += event.changeY;

      requestNearestSlot(fileNumber.value)
    })
    .onFinalize(() => {
      requestNearestSlot(null);
    })

  const tap =
    Gesture
    .Tap()
    .requireExternalGestureToFail(pan)
    .onStart(() => {
      scheduleOnRN(addImageOnStart);
    })

  const composedGesture = uriState && moveable
    ? Gesture.Exclusive(pan, tap)
    : tap;

  const removeGesture =
    Gesture
    .Tap()
    .onStart(() => {
      if (uriState === null || isLoading) {
        return;
      }

      scheduleOnRN(removeImageOnTap);
    });

  const onSlotAssignmentStart = useCallback(
    (data: SlotAssignmentStart | undefined) => {
      scheduleOnUI(
        (data) => {
          'worklet';

          if (!data) {
            return;
          }
          if (fileNumber.value !== data.from) {
            return;
          }
          if (isSlotAssignmentUnfinished.value) {
            return;
          }

          if (fileNumber.value !== data.pressed) {
            translateX.value = withTiming(_slots.value[data.to].origin.x);
            translateY.value = withTiming(_slots.value[data.to].origin.y);
            scale.value = withTiming(1);
            scheduleOnRN(setZIndex, 0)
          }
          borderRadius.value = withTiming(getBorderRadius(data.to));

          if (data.pressed === null) {
            isSlotAssignmentUnfinished.value = true;
            fileNumber.value = data.to;
          }
        },
        data
      );
    },
    [getBorderRadius]
  );

  const onSlotAssignmentFinish = useCallback(() => {
    notify<Images>(
      EV_IMAGES,
      { [fileNumber.value]: { exists: Boolean(uriRef.current) } });

    notify<VerificationEvent>(
      EV_UPDATED_VERIFICATION,
      { photos: { [`${fileNumber.value}`]: isVerifiedRef.current } });

    isSlotAssignmentUnfinished.value = false;
  }, [uriState, isVerifiedState]);

  useEffect(
    () => { translateX.value = absolutePosition?.left ?? 0; },
    [absolutePosition?.left]);

  useEffect(
    () => { translateY.value = absolutePosition?.top ?? 0; },
    [absolutePosition?.top]);

  useEffect(
    () => { _slots.value = slots; },
    [slots]);

  useImagePickerResult(input, fileNumber);

  useEffect(() => {
    return listen<SlotAssignmentStart>(
      EV_SLOT_ASSIGNMENT_START,
      onSlotAssignmentStart
    );
  }, [onSlotAssignmentStart]);

  useEffect(() => {
    return listen(
      EV_SLOT_ASSIGNMENT_FINISH,
      onSlotAssignmentFinish
    );
  }, [onSlotAssignmentFinish]);

  useEffect(() => {
    notify<Images>(
      EV_IMAGES,
      { [fileNumber.value]: { exists: Boolean(uriRef.current) } });
  }, [uriState]);

  useLayoutEffect(() => {
    borderRadius.value = getBorderRadius(fileNumber.value);
  }, [getBorderRadius]);

  const borderRadiusStyle = useAnimatedStyle(() => ({
    borderRadius: borderRadius.value,
  }));

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View
        style={{
          cursor: 'pointer',
          zIndex: zIndex,
          position: absolutePosition ? 'absolute' : undefined,
          height: absolutePosition?.height ?? '100%',
          width: absolutePosition?.width ?? '100%',
          left: absolutePosition ? 0 : undefined,
          top: absolutePosition? 0 : undefined,
          transform: [
            { translateX },
            { translateY },
            { scale },
          ],
        }}
      >
        <Animated.View
          style={[
            {
              height: '100%',
              width: '100%',
              overflow: 'hidden',
            },
            borderRadiusStyle,
          ]}
        >
          {uriState &&
            <ExpoImage
              pointerEvents="none"
              source={{
                uri: uriState,
                height: 450,
                width: 450,
              }}
              placeholder={initialBlurhash && { blurhash: initialBlurhash }}
              transition={150}
              style={{
                height: '100%',
                width: '100%',
                borderColor: appTheme.inputColor,
              }}
              contentFit="contain"
            />
          }
          {isLoading &&
            <Loading/>
          }
        </Animated.View>
        {uriState &&
          <GestureDetector gesture={removeGesture}>
            <View
              style={{
                position: 'absolute',
                top: -10,
                left: -10,
                padding: 2,
                borderRadius: 999,
                backgroundColor: 'white',
              }}
            >
              <FontAwesomeIcon
                icon={faCircleXmark}
                size={26}
                color="#000"
              />
            </View>
          </GestureDetector>
        }
        {isVerifiedState && (
          <VerificationBadge
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
            }}
            size={20}
          />
        )}
      </Animated.View>
    </GestureDetector>
  );
};

const Slot = ({
  fileNumber,
  round = false,
}: {
  fileNumber?: number
  round?: boolean
}) => {
  const { appTheme } = useAppTheme();
  const viewRef = useRef<View>(null);
  const measurementRef = useRef([0, 0, 0, 0]);

  useEffect(() => {
    viewRef.current?.measureInWindow((x, y, width, height) => {
      const newMeasurement = [x, y, width, height];

      if (width === 0 && height === 0) {
        // Measurement is inaccurate because the element is occluded
        return;
      }

      if (_.isEqual(newMeasurement, measurementRef.current)) {
        // The measurement hasn't changed
        return;
      } else {
        measurementRef.current = newMeasurement;
      }

      if (fileNumber === undefined) {
        return;
      }

      const center: Point2D = {
        x: x + width / 2,
        y: y + height / 2,
      };

      const origin: Point2D = {
        x: x,
        y: y,
      };

      const slot: Slot = {
        center,
        origin,
        height,
        width,
      };

      notify<Slots>('slots', { [fileNumber]: slot });
    });
  });

  return (
    <View
      ref={viewRef}
      style={{
        borderRadius: round ? 999 : 5,
        backgroundColor: appTheme.inputColor,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'visible',
        width: '100%',
        aspectRatio: 1,
      }}
    >
      <AddIcon/>
    </View>
  );
};

const FirstSlotRow = ({
  firstFileNumber,
}: {
  firstFileNumber: number
}) => {
  const [name, setName] = useState(lastEvent<string>(EV_UPDATED_NAME));
  const [flair, setFlair] = useState(lastEvent<string[]>(EV_UPDATED_FLAIR));

  useEffect(() => listen<string>(EV_UPDATED_NAME, setName), []);
  useEffect(() => listen<string[]>(EV_UPDATED_FLAIR, setFlair), []);

  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 20,
        width: '100%',
        paddingBottom: 20,
      }}
    >
      <View style={{ flex: 1 }}>
        <Slot fileNumber={firstFileNumber + 0} round={true} />
      </View>
      <View
        style={{
          flex: 2,
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <DefaultText
          style={{
            fontSize: 28,
            fontWeight: '700',
            borderRadius: 10,
          }}
        >
          {name}
        </DefaultText>
        <Flair flair={flair ?? []} />
      </View>
    </View>
  );
};

const SlotRow = ({
  firstFileNumber,
}: {
  firstFileNumber: number
}) => {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 10,
        width: '100%',
      }}
    >
      <View style={{ flex: 1 }}>
        <Slot fileNumber={firstFileNumber + 0} />
      </View>
      <View style={{ flex: 1 }}>
        <Slot fileNumber={firstFileNumber + 1} />
      </View>
      <View style={{ flex: 1 }}>
        <Slot fileNumber={firstFileNumber + 2} />
      </View>
    </View>
  );
};

const Images = ({
  input,
  style,
}: {
  input: OptionGroupPhotos,
  style: object,
}) => {
  const viewRef = useRef<View>(null);
  const [, setLayoutChanged] = useState({});
  const [measurement, setMeasurement] = useState([0, 0, 0, 0]);
  const [images, setImages] = useState(
    lastEvent<Images>(EV_IMAGES) ?? {});
  const [slots, setSlots] = useState(
    lastEvent<Slots>(EV_SLOTS) ?? {});

  const [x, y] = measurement;

  const relativeSlots = getRelativeSlots(slots, x, y);

  const identityAssignment = useCallback(
    _.debounce(
      () => {
        for (let i = 1; i <= 7; i++) {
          notify<SlotAssignmentStart>(
            EV_SLOT_ASSIGNMENT_START,
            { from: i, to: i, pressed: null }
          );
        }

        notify(EV_SLOT_ASSIGNMENT_FINISH);
      },
      500,
      { maxWait: 500 },
    ),
    []
  );

  const onSlotRequest = useCallback((data: SlotRequest | undefined) => {
    if (!data) {
      return;
    }

    const occupancyMap = getOccupancyMap(images);

    const remappedSlots = remap(occupancyMap, data.from, data.to);

    const pressed = data.pressed;

    const httpPostAssignments: HttpPostAssignments = {};

    Object
      .entries(remappedSlots)
      .map(([from, to]) => ([Number(from), Number(to)]))
      .forEach(([from, to]) => {
        notify<SlotAssignmentStart>(
          EV_SLOT_ASSIGNMENT_START,
          { from, to, pressed }
        );

        if (from !== to) {
          httpPostAssignments[from] = to;
        }
      });

    notify(EV_SLOT_ASSIGNMENT_FINISH);

    if (!_.isEmpty(httpPostAssignments) && pressed === null) {
      postAssignments(httpPostAssignments);
    }
  }, [images]);

  const onSlots = useCallback((data: Slots | undefined) => {
    setSlots((old) => merge(old, data));
  }, []);

  const onImages = useCallback((data: Images | undefined) => {
    setImages((old) => merge(old, data));
  }, []);

  useEffect(
    () => listen<SlotRequest>(EV_SLOT_REQUEST, onSlotRequest),
    [onSlotRequest]);

  useLayoutEffect(
    () => listen<Slots>(EV_SLOTS, onSlots),
    [onSlots]);

  useLayoutEffect(
    () => listen<Images>(EV_IMAGES, onImages),
    [onImages]);

  useEffect(() => {
    viewRef.current?.measureInWindow((x, y, width, height) => {
      const newMeasurement = [x, y, width, height];

      if (width === 0 && height === 0) {
        // Measurement is inaccurate because the element is occluded
        return;
      }

      if (_.isEqual(measurement, newMeasurement)) {
        return;
      } else {
        setMeasurement(newMeasurement);
      }

    });
  });

  useEffect(() => {
    identityAssignment();
  }, [measurement, slots]);

  return (
    <View
      ref={viewRef}
      onLayout={() => setLayoutChanged({})}
      style={{
        padding: 10,
        gap: 10,
        ...style
      }}
    >
      <FirstSlotRow firstFileNumber={1} />
      <SlotRow      firstFileNumber={2} />
      <SlotRow      firstFileNumber={5} />

      {Object
        .entries(relativeSlots)
        .map(([fileNumber, slot]) =>
          <MoveableImage
            key={fileNumber}
            input={input}
            initialFileNumber={Number(fileNumber)}
            absolutePosition={{
              height: slot.height,
              width: slot.width,
              left: slot.origin.x,
              top: slot.origin.y,
            }}
            slots={relativeSlots}
          />
        )
      }

      {Object
        .entries(relativeSlots)
        .map(([fileNumber, slot]) =>
          <FileNumber
            key={fileNumber}
            fileNumber={Number(fileNumber)}
            left={slot.origin.x + 2}
            top={slot.origin.y + slot.height - 2}
          />
        )
      }
    </View>
  );
};

const AddIcon = () => {
  return (
    <Ionicons
      style={{
        color: 'black',
        fontSize: 36,
      }}
      name="add"/>
  );
};

const Loading = () => {
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
      }}
    >
      <LogoActivityIndicator size="large" color="white"/>
    </View>
  );
}

export {
  Images,
  MoveableImage,
  Slot,
  useIsImageLoading,
  useUri,
};
