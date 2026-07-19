import {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import {
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { noSelect } from '../../styles';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { listen } from '../../events/events';

type ScrollViewData = {
  // The name of the Scrollview which is in control of the Scrollbar, or `null`
  // if no Scrollview is in control.
  controller: string | null;

  // A callback to call when the Scrollbar's thumb is dragged
  onThumbDrag?: null | ((offset: number) => void);

  // The height of the controlling Scrollview's content
  contentHeight?: number;

  // The height of the controlling Scrollview's viewport
  scrollViewHeight?: number;

  // How far down the Scrollview has been scrolled
  offset?: number;
};

const Scrollbar = () => {
  /**
   * Single piece of state storing:
   *  - which ScrollView is controlling the scrollbar
   *  - the content/viewport heights
   *  - the current offset
   */
  const [scrollViewValues, setScrollViewValues] = useState<{
    controller: string | null;
    contentHeight: number;
    scrollViewHeight: number;
    offset: number;
  }>({
    controller: null,
    contentHeight: 0,
    scrollViewHeight: 0,
    offset: 0,
  });

  // We still keep a ref to the controlling ScrollView’s data,
  // mostly so we can store the onThumbDrag callback.
  const scrollViewDataRef = useRef<ScrollViewData>({ controller: null });

  // The current Reanimated thumb position
  const thumbPosition = useSharedValue(0);

  // Where the thumb was when the user first put their finger down
  const gestureStartY = useSharedValue(0);

  // Optional: track if user is dragging right now
  const isDragging = useRef(false);

  // Keep track of the old contentHeight so we can preserve offset after changes
  const oldContentHeightRef = useRef(0);

  const { height: trackHeight } = useWindowDimensions();

  /**
   * Calculate the thumb height each render
   */
  const minThumbHeight = 30;
  const thumbHeight = (() => {
    const { contentHeight, scrollViewHeight } = scrollViewValues;
    if (contentHeight <= 0) {
      return minThumbHeight;
    }
    return Math.min(
      trackHeight,
      Math.max(
        (scrollViewHeight / contentHeight) * scrollViewHeight,
        minThumbHeight
      )
    );
  })();

  // Just a helper to store these in refs so the PanResponder can use them
  const contentHeightRef = useRef(scrollViewValues.contentHeight);
  const scrollHeightRef = useRef(scrollViewValues.scrollViewHeight);
  const maxThumbOffsetRef = useRef(trackHeight - thumbHeight);

  // Shared versions for worklet usage
  const contentHeightShared = useSharedValue(scrollViewValues.contentHeight);
  const scrollHeightShared = useSharedValue(scrollViewValues.scrollViewHeight);
  const maxThumbOffsetShared = useSharedValue(trackHeight - thumbHeight);

  /**
   * Immediately sets the thumb position based on a given scrollY.
   */
  const updateThumbPosition = (scrollY: number) => {
    const maxScroll =
      contentHeightRef.current - scrollHeightRef.current;
    if (maxScroll <= 0) {
      // No scrolling possible => put thumb at top
      thumbPosition.value = 0;
      return;
    }
    const ratio = scrollY / maxScroll;
    const newThumbOffset = ratio * maxThumbOffsetRef.current;
    thumbPosition.value = newThumbOffset;
  };

  /**
   * Attempt to acquire or release control of the scrollbar.
   * A ScrollView has to have `onThumbDrag` to take control.
   * A ScrollView with `onThumbDrag===null` releases control
   * (but only if it owns the lock).
   */
  const tryControl = (data: ScrollViewData): boolean => {
    // Attempt to acquire lock
    if (data.onThumbDrag) {
      setScrollViewValues(prev => ({
        ...prev,
        controller: data.controller,
      }));
      scrollViewDataRef.current.controller = data.controller;
      return true;
    }

    // Attempt to release lock
    if (
      data.onThumbDrag === null &&
      data.controller === scrollViewDataRef.current.controller
    ) {
      setScrollViewValues(prev => ({
        ...prev,
        controller: null,
      }));
      scrollViewDataRef.current.controller = null;
      return false;
    }

    // Do we already have the lock?
    return scrollViewDataRef.current.controller === data.controller;
  };

  // JS callback helpers for worklets
  const setIsDraggingJS = useCallback((value: boolean) => {
    isDragging.current = value;
  }, []);
  const callOnThumbDrag = useCallback((y: number) => {
    scrollViewDataRef.current.onThumbDrag?.(y);
  }, []);

  /**
   * Gesture handler to handle drag events on the thumb.
   */
  const panGesture = Gesture.Pan()
    .minDistance(0)
    .onStart(() => {
      // touchAction: 'none' in styles prevents default on web
      scheduleOnRN(() => setIsDraggingJS(true));
      gestureStartY.value = thumbPosition.value;
    })
    .onChange((evt) => {
      const dy = evt.translationY;
      const currentMaxThumbOffset = maxThumbOffsetShared.value;

      // Proposed new thumb offset (clamp top/bottom)
      let newOffset = gestureStartY.value + dy;
      newOffset = Math.max(0, Math.min(newOffset, currentMaxThumbOffset));

      // Convert thumb offset -> content scroll offset
      const maxScroll = contentHeightShared.value - scrollHeightShared.value;
      const newScrollY =
        maxScroll <= 0 ? 0 : (newOffset / currentMaxThumbOffset) * maxScroll;

      // Notify parent to scroll and update the thumb immediately
      scheduleOnRN(() => callOnThumbDrag(newScrollY));
      thumbPosition.value = newOffset;
    })
    .onFinalize(() => {
      scheduleOnRN(() => setIsDraggingJS(false));
    });

  /**
   * Animated style for the thumb translateY
   */
  const animatedThumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: thumbPosition.value }],
  }));

  /**
   * 1) Whenever scrollViewValues (contentHeight, scrollViewHeight, offset) changes,
   *    store them in refs so PanResponder can read updated data.
   * 2) If we’re not dragging, move the thumb to match the new offset.
   */
  useEffect(() => {
    contentHeightRef.current = scrollViewValues.contentHeight;
    scrollHeightRef.current = scrollViewValues.scrollViewHeight;
    maxThumbOffsetRef.current = trackHeight - thumbHeight;

    // keep shared mirrors in sync for worklets
    contentHeightShared.value = scrollViewValues.contentHeight;
    scrollHeightShared.value = scrollViewValues.scrollViewHeight;
    maxThumbOffsetShared.value = trackHeight - thumbHeight;

    if (!isDragging.current) {
      updateThumbPosition(scrollViewValues.offset);
    }
  }, [
    scrollViewValues.contentHeight,
    scrollViewValues.scrollViewHeight,
    scrollViewValues.offset,
    thumbHeight,
    trackHeight,
  ]);

  /**
   * Preserve the user’s scroll offset when new content arrives (e.g., infinite scroll).
   * If the content changes while the user is not actively dragging, we keep the same
   * “absolute” offset in terms of pixels scrolled. If user is dragging, skip or handle differently.
   */
  useEffect(() => {
    const oldContentHeight = oldContentHeightRef.current;
    oldContentHeightRef.current = scrollViewValues.contentHeight;

    // If there's no old content height or it hasn't changed, do nothing
    if (!oldContentHeight || oldContentHeight === scrollViewValues.contentHeight) {
      return;
    }
    if (isDragging.current) {
      // If user is in the middle of a drag, you might decide to skip
      // updating the offset here. Or handle it differently.
      return;
    }

    // The current ScrollView offset in px (use state offset)
    const oldMaxScroll = oldContentHeight - scrollViewValues.scrollViewHeight;
    const newMaxScroll =
      scrollViewValues.contentHeight - scrollViewValues.scrollViewHeight;

    // Keep same absolute offset, but clamp if new content is smaller
    const oldScrollY = Math.max(0, Math.min(oldMaxScroll, scrollViewValues.offset));
    const newScrollY = Math.max(0, Math.min(newMaxScroll, oldScrollY));
    updateThumbPosition(newScrollY);

    // Potentially notify the controlling ScrollView that the offset changed
    // if you want two-way sync. For example:
    // scrollViewDataRef.current.onThumbDrag?.(newScrollY);
  }, [scrollViewValues.contentHeight, scrollViewValues.scrollViewHeight]);

  /**
   * Listen for the scrollview to mount or update. Instead of immediately calling
   * updateThumbPosition(data.offset), we just set our state. Then the effect above
   * will handle repositioning the thumb once contentHeight/scrollViewHeight/offset
   * have all updated in React.
   */
  useEffect(() => {
    return listen<ScrollViewData>(
      'main-scroll-view',
      (data) => {
        if (!data) {
          return;
        }
        if (!tryControl(data)) {
          return;
        }

        if (data.onThumbDrag !== undefined) {
          scrollViewDataRef.current.onThumbDrag = data.onThumbDrag;
        }

        // Update state in one go. If data.contentHeight or data.scrollViewHeight are null,
        // we preserve the existing values.
        setScrollViewValues((prev) => ({
          controller: data.controller ?? prev.controller,
          contentHeight: data.contentHeight ?? prev.contentHeight,
          scrollViewHeight: data.scrollViewHeight ?? prev.scrollViewHeight,
          offset: data.offset ?? prev.offset,
        }));
      },
      true
    );
  }, []);

  /**
   * Handle mouse wheel scrolling on web. We again read the “current” offsets
   * from refs, and if we can scroll, we convert deltaY to a newScrollY.
   */
  const handleWheel = (e: { deltaY: number; preventDefault?: () => void }) => {
    if (Platform.OS !== 'web') {
      return;
    }
    e.preventDefault?.();

    const delta = e.deltaY; // how much the wheel scrolled
    const maxScroll =
      contentHeightRef.current - scrollHeightRef.current;

    // Use current offset from state
    let currentScrollY = Math.max(0, Math.min(maxScroll, scrollViewValues.offset));

    // Apply the delta. Might need to tune this factor for a better feel
    const newScrollY = Math.min(
      Math.max(currentScrollY + delta, 0),
      maxScroll
    );

    // Notify parent, update thumb
    scrollViewDataRef.current.onThumbDrag?.(newScrollY);
    updateThumbPosition(newScrollY);
  };

  // If no controller or if the thumb is the full height => hide
  if (!scrollViewValues.controller || thumbHeight === trackHeight) {
    return null;
  }

  return (
    <View
      {...(Platform.OS === 'web' ? { onWheel: handleWheel } : {})}
      style={[styles.scrollbar, { height: trackHeight }]}
    >
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[
            styles.thumb,
            {
              height: thumbHeight,
            },
            animatedThumbStyle,
          ]}
        />
      </GestureDetector>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollbar: {
    width: 14,
    backgroundColor: '#ddd',
    position: 'absolute',
    right: 0,
    top: 0,

    ...noSelect,
  },
  thumb: {
    width: '100%',
    backgroundColor: '#70f',
    borderRadius: 99,

    ...(Platform.OS === 'web' ? {
      touchAction: 'none',         // prevent selection on web
    } : {}),
  },
});

export {
  Scrollbar,
  ScrollViewData,
};
