import { RefObject, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { VideoContentFit, VideoView, useVideoPlayer } from 'expo-video';
import Ionicons from '@expo/vector-icons/Ionicons';

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
  const player = useVideoPlayer(uri, (player) => {
    player.loop = true;
    player.muted = muted;
  });

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  useEffect(() => {
    if (playing) {
      player.play();
    } else {
      player.pause();
    }
  }, [player, playing]);

  return (
    <VideoView
      player={player}
      style={{ position: 'absolute', width: '100%', height: '100%' }}
      contentFit={contentFit}
      nativeControls={false}
      surfaceType="textureView"
      useExoShutter={false}
      playsInline={true}
      pointerEvents="none"
    />
  );
};

const useIsOnScreen = (ref: RefObject<View | null>): boolean => {
  const [isOnScreen, setIsOnScreen] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      ref.current?.measureInWindow((x, y, width, height) => {
        const window = Dimensions.get('window');

        setIsOnScreen(
          width > 0 &&
          height > 0 &&
          x < window.width &&
          x + width > 0 &&
          y < window.height &&
          y + height > 0
        );
      });
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return isOnScreen;
};

const AutoplayVideo = ({
  uri,
  paused = false,
}: {
  uri: string
  paused?: boolean
}) => {
  const ref = useRef<View>(null);
  const isOnScreen = useIsOnScreen(ref);
  const [hasBeenOnScreen, setHasBeenOnScreen] = useState(false);

  useEffect(() => {
    if (isOnScreen) {
      setHasBeenOnScreen(true);
    }
  }, [isOnScreen]);

  return (
    <View ref={ref} style={StyleSheet.absoluteFill} pointerEvents="none">
      {hasBeenOnScreen &&
        <LoopingVideo
          uri={uri}
          muted={true}
          playing={isOnScreen && !paused}
          contentFit="cover"
        />
      }
    </View>
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
    style={[
      {
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        alignItems: 'center',
        justifyContent: 'center',
      },
      style,
    ]}
  >
    <Ionicons
      name="play"
      size={size * 0.55}
      color="white"
      style={{ marginLeft: size * 0.08 }}
    />
  </View>
);

export {
  AutoplayVideo,
  LoopingVideo,
  PlayBadge,
};
