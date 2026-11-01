import { RefObject, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Platform,
  PointerEvent,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { VideoContentFit, VideoPlayer } from 'expo-video';
import { useEvent } from 'expo';
import { useIsFocused } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import Animated from 'react-native-reanimated';
import { AnimatedPressable, hoverTransition } from './hover';
import { Pressable } from './pressable';
import * as _ from 'lodash';
import { lastEvent, notify, useDerivedEvent } from '../events/events';
import { useSharedVideo } from './shared-video';
import { VideoSurface } from './video-surface';

const EV_VIDEO_MUTED = 'video-muted';
const EV_FOCUSED_VIDEO = 'focused-video';
const CONTROLS_IDLE_MS = 2500;
const CAN_HOVER =
  Platform.OS === 'web' && window.matchMedia('(hover: hover)').matches;

const useVideoMuted = () =>
  useDerivedEvent<boolean, boolean>(
    EV_VIDEO_MUTED,
    (muted) => muted ?? true,
    [],
  );

const unmuteVideos = () => notify<boolean>(EV_VIDEO_MUTED, false);

const LoopingVideo = ({
  uri,
  muted,
  playing,
  contentFit,
}: {
  uri: string
  muted: boolean
  playing: boolean
  contentFit: VideoContentFit
}) => {
  const player = useSharedVideo(uri, playing, !muted);

  return player && <VideoSurface player={player} contentFit={contentFit} />;
};

const useVisibleFraction = (ref: RefObject<View | null>): number => {
  const [visibleFraction, setVisibleFraction] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      ref.current?.measureInWindow((x, y, width, height) => {
        const window = Dimensions.get('window');

        const visibleWidth = Math.min(x + width, window.width) - Math.max(x, 0);
        const visibleHeight = Math.min(y + height, window.height) - Math.max(y, 0);

        setVisibleFraction(
          width > 0 && height > 0 && visibleWidth > 0 && visibleHeight > 0
            ? visibleWidth * visibleHeight / (width * height)
            : 0
        );
      });
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return visibleFraction;
};

const visibleFractions = new Map<string, number>();

const reportVisibleFraction = (id: string, visibleFraction: number) => {
  if (visibleFraction > 0) {
    visibleFractions.set(id, visibleFraction);
  } else {
    visibleFractions.delete(id);
  }

  const focused = _.maxBy([...visibleFractions], ([, f]) => f)?.[0] ?? null;

  if (focused !== (lastEvent<string | null>(EV_FOCUSED_VIDEO) ?? null)) {
    notify<string | null>(EV_FOCUSED_VIDEO, focused);
  }
};

const useControlsVisibility = (playing: boolean) => {
  const [isPointerActive, setIsPointerActive] = useState(false);
  const [isHeld, setIsHeld] = useState(false);
  const hideTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(hideTimeout.current), []);

  const pointerProps = useMemo(() => {
    const show = (e: PointerEvent) => {
      if (e.nativeEvent.pointerType === 'touch') {
        return;
      }

      setIsPointerActive(true);
      clearTimeout(hideTimeout.current);
      hideTimeout.current = setTimeout(
        () => setIsPointerActive(false),
        CONTROLS_IDLE_MS,
      );
    };

    return {
      onPointerEnter: show,
      onPointerMove: show,
      onPointerLeave: () => {
        clearTimeout(hideTimeout.current);
        setIsPointerActive(false);
      },
    };
  }, []);

  return {
    controlsVisible: !CAN_HOVER || isPointerActive || isHeld || !playing,
    holdControls: setIsHeld,
    pointerProps,
  };
};

const useControlHover = (onHoverChange: (hovered: boolean) => void) => {
  const [hovered, setHovered] = useState(false);

  const hoverProps = {
    onPointerEnter: (e: PointerEvent) => {
      if (e.nativeEvent.pointerType === 'touch') {
        return;
      }

      setHovered(true);
      onHoverChange(true);
    },
    onPointerLeave: () => {
      setHovered(false);
      onHoverChange(false);
    },
  };

  return { hovered, hoverProps };
};

const AutoplayVideo = ({
  uri,
  withControls = false,
  surfaceHidden,
  opening,
}: {
  uri: string
  withControls?: boolean
  surfaceHidden: boolean
  opening: boolean
}) => {
  const id = useId();
  const isScreenFocused = useIsFocused();
  const ref = useRef<View>(null);
  const visibleFraction = useVisibleFraction(ref);
  const [hasPlayed, setHasPlayed] = useState(false);
  const videoMuted = useVideoMuted();
  const isFocused = useDerivedEvent<string | null, boolean>(
    EV_FOCUSED_VIDEO,
    (focused) => focused === id,
    [id],
  );
  const [userPaused, setUserPaused] = useState(false);

  const playing = opening || isScreenFocused && (
    withControls ? isFocused && !userPaused : visibleFraction > 0);
  const player = useSharedVideo(
    hasPlayed ? uri : null,
    playing,
    withControls && isScreenFocused && isFocused && !videoMuted,
  );
  const { controlsVisible, holdControls, pointerProps } =
    useControlsVisibility(playing);

  if (playing && !hasPlayed) {
    setHasPlayed(true);
  }

  useEffect(() => {
    if (withControls) {
      reportVisibleFraction(id, visibleFraction);
    }
  }, [withControls, visibleFraction]);

  useEffect(() => () => reportVisibleFraction(id, 0), []);

  useEffect(() => {
    if (!isFocused) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUserPaused(false);
      holdControls(false);
    }
  }, [isFocused]);

  return (
    <View
      ref={ref}
      style={StyleSheet.absoluteFill}
      {...(withControls ? pointerProps : {})}
    >
      {player && (Platform.OS === 'web' || !surfaceHidden) &&
        <VideoSurface player={player} contentFit="cover" />
      }
      {withControls && isFocused && player &&
        <VideoControls
          player={player}
          playing={playing}
          onTogglePlaying={() => setUserPaused((paused) => !paused)}
          visible={controlsVisible}
          onHoverChange={holdControls}
        />
      }
    </View>
  );
};

const VideoControls = ({
  player,
  playing,
  onTogglePlaying,
  visible,
  onHoverChange,
  style,
}: {
  player: VideoPlayer
  playing: boolean
  onTogglePlaying: () => void
  visible: boolean
  onHoverChange: (hovered: boolean) => void
  style?: StyleProp<ViewStyle>
}) => (
  <Animated.View
    pointerEvents={visible ? 'box-none' : 'none'}
    style={[
      StyleSheet.absoluteFill,
      style,
      { opacity: visible ? 1 : 0 },
      hoverTransition('opacity'),
    ]}
  >
    <ControlButton
      icon={playing ? 'pause' : 'play'}
      label={playing ? 'Pause' : 'Play'}
      style={{ left: 10, bottom: 10 }}
      onPress={onTogglePlaying}
      onHoverChange={onHoverChange}
    />
    <VideoProgress player={player} onHoverChange={onHoverChange} />
    <SoundButton onHoverChange={onHoverChange} />
  </Animated.View>
);

const ControlButton = ({
  icon,
  label,
  style,
  onPress,
  onHoverChange,
}: {
  icon: 'pause' | 'play' | 'volume-mute' | 'volume-high'
  label: string
  style: StyleProp<ViewStyle>
  onPress: () => void
  onHoverChange: (hovered: boolean) => void
}) => {
  const { hovered, hoverProps } = useControlHover(onHoverChange);

  return (
    <AnimatedPressable
      onPress={onPress}
      {...hoverProps}
      hitSlop={8}
      aria-label={label}
      style={[
        styles.circle,
        styles.controlButton,
        { backgroundColor: hovered ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0.55)' },
        hoverTransition('backgroundColor'),
        style,
      ]}
    >
      <Ionicons name={icon} size={16} color="white" />
    </AnimatedPressable>
  );
};

const SoundButton = ({
  onHoverChange,
}: {
  onHoverChange: (hovered: boolean) => void
}) => {
  const muted = useVideoMuted();

  return (
    <ControlButton
      icon={muted ? 'volume-mute' : 'volume-high'}
      label={muted ? 'Unmute' : 'Mute'}
      style={{ right: 10, bottom: 10 }}
      onPress={() => notify<boolean>(EV_VIDEO_MUTED, !muted)}
      onHoverChange={onHoverChange}
    />
  );
};

const VideoProgress = ({
  player,
  onHoverChange,
}: {
  player: VideoPlayer
  onHoverChange: (hovered: boolean) => void
}) => {
  const time = useEvent(player, 'timeUpdate', null);
  const [width, setWidth] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const { hovered, hoverProps } = useControlHover(onHoverChange);

  const scrubGesture = useMemo(() => {
    const seek = (x: number) => {
      const fraction = _.clamp(x / width, 0, 1);
      setScrub(fraction);

      if (player.duration > 0) {
        // eslint-disable-next-line react-hooks/immutability
        player.currentTime = fraction * player.duration;
      }
    };

    return Gesture.Pan()
      .minDistance(0)
      .onBegin((e) => {
        scheduleOnRN(seek, e.x);
      })
      .onUpdate((e) => {
        scheduleOnRN(seek, e.x);
      })
      .onFinalize(() => {
        scheduleOnRN(setScrub, null);
      });
  }, [player, width]);

  const progress = scrub ?? (
    player.duration > 0 ? (time?.currentTime ?? 0) / player.duration : 0);

  const active = hovered || scrub !== null;

  return (
    <Pressable
      onPress={_.noop}
      {...hoverProps}
      style={styles.progressTouchArea}
    >
      <GestureDetector gesture={scrubGesture}>
        <View
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          style={[StyleSheet.absoluteFill, { justifyContent: 'center' }]}
        >
          <Animated.View
            style={[
              styles.progressTrack,
              { height: active ? 6 : 3 },
              hoverTransition('height'),
            ]}
          >
            <View
              style={[styles.progressFill, { width: `${progress * 100}%` }]}
            />
          </Animated.View>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.progressHandle,
              { left: `${progress * 100}%`, opacity: active ? 1 : 0 },
              hoverTransition('opacity'),
            ]}
          />
        </View>
      </GestureDetector>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  circle: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlButton: {
    width: 32,
    height: 32,
    cursor: 'pointer',
  },
  progressTouchArea: {
    position: 'absolute',
    left: 52,
    right: 52,
    bottom: 12,
    height: 28,
    cursor: 'pointer',
  },
  progressHandle: {
    position: 'absolute',
    width: 12,
    height: 12,
    marginLeft: -6,
    borderRadius: 6,
    backgroundColor: 'white',
  },
  progressTrack: {
    borderRadius: 3,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: 'white',
  },
});

export {
  AutoplayVideo,
  LoopingVideo,
  VideoControls,
  unmuteVideos,
  useControlsVisibility,
  useVideoMuted,
};
