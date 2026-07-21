import { possessive, secToMinSec, safeBestTextOn } from '../util/util';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View, Pressable, StyleSheet, ViewStyle } from 'react-native';
import {
  AudioStatus,
  setAudioModeAsync,
  useAudioPlayer,
} from 'expo-audio';
import { AUDIO_URL } from '../env/env';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DefaultText } from './default-text';
import { useAppTheme } from '../app-theme/app-theme';
import { themedSurface } from '../app-theme/surface';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {
  LinearGradient,
} from 'expo-linear-gradient';
import * as _ from 'lodash';

const LoadingBar = () => {
  const duration = 500;
  const progress = useSharedValue(1);

  const barWidthPct = 40;

  useEffect(() => {
    // Animate progress from 0 to 1 and reverse it to create a bounce effect.
    progress.value = withRepeat(withTiming(0, { duration }), -1, true);
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      left: `${progress.value * (100 - barWidthPct)}%`,
    };
  });

  return (
    <View style={styles.loadingBarContainer}>
      <View style={styles.loadingBar}>
        <Animated.View
          style={[
            styles.loadingBarFill,
            animatedStyle,
            { width: `${barWidthPct}%` },
          ]}
        >
          <LinearGradient
            colors={['transparent', '#000', 'transparent']}
            style={{ width: '100%', height: '100%' }}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          />
        </Animated.View>
      </View>
    </View>
  );
};

type AudioPlayerProps = {
  name: string | null | undefined,
  uuid: string | null | undefined,
  presentation: 'profile'
  bodyColor?: string
  style?: ViewStyle
} | {
  uuid: string | null | undefined,
  presentation: 'feed',
  style?: ViewStyle
} | {
  uuid: string | null | undefined,
  sending: boolean,
  presentation: 'conversation',
  onPressBody?: () => void
  style?: ViewStyle
};

const AudioPlayer = (props: AudioPlayerProps) => {
  const { appThemeName, appTheme } = useAppTheme();

  // Deferred load: scrolling past dozens of messages shouldn't fetch them all.
  const player = useAudioPlayer(null);
  const hasLoaded = useRef(false);

  const isMounted = useRef(true);

  const [isPlaying, setIsPlaying] = useState(false);

  const [isPlaybackStarting, setIsPlaybackStarting] = useState(false);

  const [isBuffering, setIsBuffering] = useState(false);

  const [secondsElapsed, setSecondsElapsed] = useState(0);

  const [minutes, seconds] = secToMinSec(secondsElapsed);

  const [showLoader, setShowLoader] = useState(
    props.presentation === 'conversation' && props.sending
  );

  const playIcon = isPlaying ? 'pause' : 'play';

  const debouncedShowLoader = useRef(
    _.debounce((x: boolean) => setShowLoader(x), 200)
  ).current;

  const nextDebouncedShowLoaderValue = (
      isPlaybackStarting
      || isPlaying && isBuffering
      || !props.uuid && props.presentation === 'conversation' && props.sending
  );

  useEffect(() => {
    // Debouncing the loader is necessary to stop it from briefly flickering
    // in the case that the audio has already been fetched from the server
    debouncedShowLoader(nextDebouncedShowLoaderValue);
  }, [nextDebouncedShowLoaderValue])

  const onPlaybackStatusUpdate = useCallback((status: AudioStatus) => {
    if (!isMounted.current) {
      return;
    }

    if (!status.isLoaded) {
      return;
    }

    setIsPlaybackStarting(false);
    setSecondsElapsed(Math.floor(status.currentTime));
    setIsBuffering(status.isBuffering);

    if (status.didJustFinish) {
      setIsPlaying(false);
      player.pause();
      player.seekTo(0);
    }
  }, [player]);

  useEffect(() => {
    const subscription = player.addListener(
      'playbackStatusUpdate',
      onPlaybackStatusUpdate,
    );
    return () => subscription.remove();
  }, [player, onPlaybackStatusUpdate]);

  const play = async () => {
    if (!props.uuid) {
      return;
    }

    if (isPlaybackStarting) {
      return;
    }

    setIsPlaybackStarting(true);
    setIsPlaying(true);

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
      });

      if (!isMounted.current) {
        return;
      }

      if (!hasLoaded.current) {
        player.replace({ uri: `${AUDIO_URL}/${props.uuid}.aac` });
        hasLoaded.current = true;
      }

      player.play();
    } catch (err) {
      setIsPlaying(false);
      setIsPlaybackStarting(false);
      console.error('Failed to start playback', err);
    }
  };

  const pause = () => {
    setIsPlaying(false);
    player.pause();
  };

  const togglePlayPause = () => {
    if (isPlaybackStarting) return;

    if (isPlaying) {
      pause();
    } else {
      play();
    }
  };

  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    hasLoaded.current = false;
    setIsPlaying(false);
    setSecondsElapsed(0);
  }, [props.uuid]);

  const middleText = (() => {
    if (props.presentation === 'conversation') {
      return !props.uuid && !props.sending ? 'failed to send' : 'voice message';
    } else if (props.presentation === 'feed') {
      return 'Voice bio'
    } else if (props.name) {
      return `${possessive(props.name)} voice bio`
    } else {
      return 'failed to send';
    }
  })();

  const bodyColor = props.presentation === 'profile' ? props.bodyColor : undefined;

  const isConversation = props.presentation === 'conversation';
  const onPressBody = isConversation ? props.onPressBody : undefined;
  const surface = isConversation
    ? {
        backgroundColor: 'rgba(255, 255, 255, 0.3)',
        borderColor: 'rgba(0, 0, 0, 0.1)',
      }
    : themedSurface(appThemeName, appTheme.surface, bodyColor);

  const body = (
    <>
      <View style={styles.middleContainer}>
        <DefaultText
          style={[
            styles.middleText,
            showLoader ? styles.transparent : null,
            bodyColor ? { color: bodyColor } : null,
          ]}
        >
          {middleText}
        </DefaultText>

        {showLoader &&
          <LoadingBar/>
        }
      </View>

      <DefaultText
        style={[
          {
            textAlign: 'right',
            paddingRight: isConversation ? 10 : 5,
            width: 50,
          },
          bodyColor ? { color: bodyColor } : null,
        ]}
      >
        {`${minutes}:${seconds}`}
      </DefaultText>
    </>
  );

  const playButtonColor = bodyColor ?? appTheme.secondaryColor;
  const playIconColor = bodyColor
    ? safeBestTextOn(bodyColor, appTheme.primaryColor)
    : appTheme.primaryColor;

  return (
    <View
      style={{
        width: '100%',
        maxWidth: isConversation ? 275 : undefined,
        marginTop: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderWidth: 1,
        borderRadius: isConversation ? 999 : 12,
        padding: 12,
        gap: 20,
        ...surface,
        ...props.style,
      }}
    >
      <Pressable
        style={{
          backgroundColor: playButtonColor,
          borderRadius: 999,
          height: 36,
          width: 36,
          justifyContent: 'center',
          alignItems: 'center',
        }}
        onPress={togglePlayPause}
        disabled={isPlaybackStarting || isBuffering}
      >
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left:  playIcon === 'play' ?  1 : 0,
            right: playIcon === 'play' ? -1 : 0,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Ionicons style={{ fontSize: 24, color: playIconColor }} name={playIcon} />
        </View>
      </Pressable>

      {onPressBody ?
        <Pressable style={styles.body} onPress={onPressBody}>{body}</Pressable>
      :
        <View style={styles.body}>{body}</View>
      }
    </View>
  );
};

const styles = StyleSheet.create({
  body: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  middleContainer: {
    flex: 3,
    justifyContent: 'center',
  },
  middleText: {
    fontWeight: 700,
    ...(Platform.OS === 'web' ? {
      wordBreak: 'break-all',
    } : {}),
    textAlign: 'center',
  },
  transparent: {
    opacity: 0,
  },
  loadingBarContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  loadingBar: {
    height: 8,
    backgroundColor: '#ddd',
    borderRadius: 4,
    overflow: 'hidden',
  },
  loadingBarFill: {
    height: '100%',
    borderRadius: 999,
  },
});

export {
  AudioPlayer,
};
