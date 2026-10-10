import { RefObject, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  GestureResponderEvent,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import {
  VideoContentFit,
  VideoPlayer,
  VideoView,
  useVideoPlayer,
} from 'expo-video';
import { useEvent } from 'expo';
import { useIsFocused } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import * as _ from 'lodash';
import { lastEvent, notify, useDerivedEvent } from '../events/events';

const EV_VIDEO_MUTED = 'video-muted';
const EV_FOCUSED_VIDEO = 'focused-video';

const useVideoMuted = () =>
  useDerivedEvent<boolean, boolean>(
    EV_VIDEO_MUTED,
    (muted) => muted ?? true,
    [],
  );

const useLoopingPlayer = (uri: string | null, muted: boolean) => {
  const player = useVideoPlayer(uri, (player) => {
    player.loop = true;
    player.muted = muted;
  });

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  return player;
};

const VideoSurface = ({
  player,
  playing,
  contentFit,
}: {
  player: VideoPlayer
  playing: boolean
  contentFit: VideoContentFit
}) => {
  useEffect(() => {
    if (playing) {
      player.play();
    } else {
      player.pause();
    }
  }, [player, playing]);

  return <VideoView
    player={player}
    style={{ position: 'absolute', width: '100%', height: '100%' }}
    contentFit={contentFit}
    nativeControls={false}
    surfaceType="textureView"
    useExoShutter={false}
    playsInline={true}
    pointerEvents="none"
  />;
};

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
}) => (
  <VideoSurface
    player={useLoopingPlayer(uri, muted)}
    playing={playing}
    contentFit={contentFit}
  />
);

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

const AutoplayVideo = ({
  uri,
  withSound = false,
}: {
  uri: string
  withSound?: boolean
}) => {
  const id = useId();
  const isScreenFocused = useIsFocused();
  const ref = useRef<View>(null);
  const visibleFraction = useVisibleFraction(ref);
  const [hasBeenOnScreen, setHasBeenOnScreen] = useState(false);
  const videoMuted = useVideoMuted();
  const isFocused = useDerivedEvent<string | null, boolean>(
    EV_FOCUSED_VIDEO,
    (focused) => focused === id,
    [id],
  );

  useEffect(() => {
    if (visibleFraction > 0) {
      setHasBeenOnScreen(true);
    }
  }, [visibleFraction]);

  useEffect(() => {
    if (withSound) {
      reportVisibleFraction(id, visibleFraction);
    }
  }, [withSound, visibleFraction]);

  useEffect(() => () => reportVisibleFraction(id, 0), []);

  return (
    <View ref={ref} style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {hasBeenOnScreen &&
        <LoopingVideo
          uri={uri}
          muted={!withSound || videoMuted || !isFocused}
          playing={visibleFraction > 0 && isScreenFocused}
          contentFit="cover"
        />
      }
      {withSound &&
        <SoundButton size={32} style={{ right: 10, bottom: 10 }} />
      }
    </View>
  );
};

const SoundButton = ({
  size,
  style,
}: {
  size: number
  style?: StyleProp<ViewStyle>
}) => {
  const muted = useVideoMuted();

  return (
    <Pressable
      onPress={(event: GestureResponderEvent) => {
        event.preventDefault();
        event.stopPropagation();
        notify<boolean>(EV_VIDEO_MUTED, !muted);
      }}
      hitSlop={8}
      aria-label={muted ? 'Unmute' : 'Mute'}
      style={[styles.circle, { width: size, height: size }, style]}
    >
      <Ionicons
        name={muted ? 'volume-mute' : 'volume-high'}
        size={size * 0.5}
        color="white"
      />
    </Pressable>
  );
};

const VideoProgress = ({ player }: { player: VideoPlayer }) => {
  const time = useEvent(player, 'timeUpdate', null);
  const [width, setWidth] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);

  useEffect(() => {
    player.timeUpdateEventInterval = 0.1;
  }, [player]);

  const scrubGesture = useMemo(() => {
    const seek = (x: number) => {
      const fraction = _.clamp(x / width, 0, 1);
      setScrub(fraction);
      player.currentTime = fraction * player.duration;
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

  return (
    <GestureDetector gesture={scrubGesture}>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={styles.progressTouchArea}
      >
        <View
          style={[
            styles.progressTrack,
            { height: scrub === null ? 3 : 6 },
          ]}
        >
          <View
            style={[styles.progressFill, { width: `${progress * 100}%` }]}
          />
        </View>
      </View>
    </GestureDetector>
  );
};

const PlayBadge = ({
  size,
  style,
}: {
  size: number
  style?: StyleProp<ViewStyle>
}) => (
  <View
    pointerEvents="none"
    style={[styles.circle, { width: size, height: size }, style]}
  >
    <Ionicons
      name="play"
      size={size * 0.55}
      color="white"
      style={{ marginLeft: size * 0.08 }}
    />
  </View>
);

const styles = StyleSheet.create({
  circle: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTouchArea: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 8,
    height: 28,
    justifyContent: 'center',
    zIndex: 1000,
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
  PlayBadge,
  SoundButton,
  VideoProgress,
  VideoSurface,
  useLoopingPlayer,
  useVideoMuted,
};
