import {
  View,
} from 'react-native';
import {
  useEffect,
  useState,
} from 'react';
import {
  AudioStatus,
  RecordingOptions,
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { secToMinSec } from '../util/util';
import { SomethingWentWrongToast } from './toast';
import { ButtonWithCenteredText } from './button/centered-text';
import { DefaultText } from './default-text';
import Ionicons from '@expo/vector-icons/Ionicons';
import { japi, uriToBase64 } from '../api/api';
import { notify } from '../events/events';
import {
  AUDIO_URL,
} from '../env/env';
import { useAppTheme } from '../app-theme/app-theme';

const recordingOptions: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  web: {
    ...RecordingPresets.HIGH_QUALITY.web,
    mimeType: undefined,
  },
};

const AudioBio = ({
  initialSavedRecordingUuid,
  maxDuration,
}: {
  initialSavedRecordingUuid: string | null
  maxDuration: number
}) => {
  type MemoryState =
    | 'No recording yet'
    | 'Unsaved recording'
    | 'Saving'
    | 'Deleting'
    | 'Saved';

  type PlayingState =
    | 'Stopped'
    | 'Playing'
    | 'Recording';

  const { appTheme } = useAppTheme();

  const [savedRecordingUri, setSavedRecordingUri] = useState(
    initialSavedRecordingUuid ?
    `${AUDIO_URL}/${initialSavedRecordingUuid}.aac` :
    null
  );

  const [unsavedRecordingUri, setUnsavedRecordingUri] = useState<
    null | string>(null);

  const [playingState, setPlayingState] = useState<PlayingState>(
    'Stopped');

  const recorder = useAudioRecorder(recordingOptions);
  const recorderState = useAudioRecorderState(recorder, 250);

  const player = useAudioPlayer(null);

  const [duration, setDuration] = useState<null | number>(); // seconds

  const [deleting, setDeleting] = useState(false);

  const [saving, setSaving] = useState(false);

  const memoryState: MemoryState = (() => {
    if (saving) {
      return 'Saving';
    }

    if (deleting) {
      return 'Deleting';
    }

    if (unsavedRecordingUri) {
      return 'Unsaved recording'
    }

    if (savedRecordingUri) {
      return 'Saved';
    }

    return 'No recording yet';
  })();

  const loading = saving || deleting;

  const playableRecordingUri = unsavedRecordingUri ?? savedRecordingUri;

  const recordButtonEnabled = playingState !== 'Playing' && !loading;

  const playButtonEnabled = (
    (playingState === 'Playing' || playingState === 'Stopped') &&
    (memoryState === 'Unsaved recording' || memoryState === 'Saved')
  );

  const discardButtonEnabled = (
    memoryState === 'Unsaved recording' || memoryState === 'Saved'
  );

  const saveButtonEnabled = memoryState === 'Unsaved recording';

  const startRecording = async () => {
    try {
      if ((await getRecordingPermissionsAsync())?.status !== 'granted') {
        await requestRecordingPermissionsAsync();
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await recorder.prepareToRecordAsync(recordingOptions);
      recorder.record();

      setPlayingState('Recording');

      return true;
    } catch (err) {
      console.error('Failed to start recording', err);
    }

    return false;
  };

  const stopRecording = async () => {
    if (!recorder.isRecording) {
      return;
    }

    await recorder.stop();

    await setAudioModeAsync({ allowsRecording: false });

    const uri = recorder.uri;

    if (!uri) {
      console.error('Recording URI was unexpectedly null');
      return;
    }

    setUnsavedRecordingUri(uri);

    setPlayingState('Stopped');

    return true;
  }

  const startPlayback = async () => {
    if (!playableRecordingUri) {
      return false;
    }

    try {
      await setAudioModeAsync({ playsInSilentMode: true });
    } catch { }

    await player.seekTo(0);
    player.play();

    setPlayingState('Playing');

    return true;
  };

  const stopPlayback = async () => {
    player.pause();
    await player.seekTo(0);

    setPlayingState('Stopped');

    return true;
  };

  const discard = async () => {
    if (unsavedRecordingUri) {
      stopPlayback();
      setDuration(null);
      setUnsavedRecordingUri(null);
    } else if (savedRecordingUri) {
      setDeleting(true);

      const response = await japi(
        'delete',
        '/profile-info',
        { audio_files: [-1] },
      );

      if (response.ok) {
        setSavedRecordingUri(null);
      } else {
        notify<React.FC>('toast', SomethingWentWrongToast);
      }

      setDeleting(false);
    }
  };

  const save = async () => {
    if (!unsavedRecordingUri) {
      return false;
    }

    setSaving(true);

    const base64 = await uriToBase64(unsavedRecordingUri);

    const response = await japi(
      'patch',
      '/profile-info',
      {
        base64_audio_file: {
          base64: `data:audio/*;base64,${base64}`,
        }
      },
    );

    if (response.ok) {
      setSavedRecordingUri(unsavedRecordingUri);
      setUnsavedRecordingUri(null);
    } else {
      notify<React.FC>('toast', SomethingWentWrongToast);
    }

    setSaving(false);

    return true;
  };

  const recordedSeconds = Math.floor(recorderState.durationMillis / 1000);

  const formattedStatus = (() => {
    const [mins, secs] = secToMinSec(
      (playingState === 'Recording' ? recordedSeconds : duration) ?? 0);
    const [maxMins, maxSecs] = secToMinSec(maxDuration);

    if (playingState === 'Recording') {
      return `Recording (${mins}:${secs}/${maxMins}:${maxSecs})`;
    }

    if (playingState === 'Playing') {
      return `Playing (${mins}:${secs})`;
    }

    return memoryState;
  })();

  useEffect(() => {
    if (!playableRecordingUri) {
      return;
    }
    player.replace({ uri: playableRecordingUri });
  }, [player, playableRecordingUri]);

  useEffect(() => {
    const subscription = player.addListener(
      'playbackStatusUpdate',
      (status: AudioStatus) => {
        if (!status.isLoaded) {
          return;
        }

        if (status.duration) {
          setDuration(Math.floor(status.currentTime));
        } else {
          setDuration(null);
        }

        if (status.didJustFinish) {
          setPlayingState('Stopped');
        }
      },
    );
    return () => subscription.remove();
  }, [player]);

  useEffect(() => {
    if (playingState === 'Recording' && recordedSeconds >= maxDuration) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      stopRecording();
    }
  }, [recordedSeconds, playingState, maxDuration]);

  return (
    <View
      style={{
        width: '100%',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: appTheme.interactiveBorderColor,
        padding: 10,
        gap: 15,
      }}
    >
      <View
        style={{
          width: '100%',
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 20,
        }}
      >
        <View
          style={{
            gap: 20,
            flexDirection: 'row',
            flex: 1,
            justifyContent: 'flex-start',
            alignItems: 'center',
          }}
        >
          <Ionicons
            disabled={!recordButtonEnabled}
            onPress={() => {
              if (!recordButtonEnabled) {
                return;
              }

              if (playingState === 'Stopped') {
                startRecording();
              }

              if (playingState === 'Recording') {
                stopRecording();
              }
            }}
            style={{
              fontSize: 52,
              color: 'crimson',
              opacity: recordButtonEnabled ? 1 : 0.2,
            }}
            name={playingState === 'Recording' ? 'stop-circle' : 'mic'}
          />
        </View>

        <View style={{ flex: 4 }} >
          <View
            style={{
              gap: 10,
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Ionicons
              disabled={!playButtonEnabled}
              onPress={async () => {
                if (!playButtonEnabled) {
                  return;
                }

                if (playingState === 'Stopped') {
                  await startPlayback();
                }

                if (playingState === 'Playing') {
                  await stopPlayback();
                }
              }}
              style={{
                flexShrink: 1,
                fontSize: 52,
                opacity: playButtonEnabled ? 1 : 0.2,
                color: appTheme.secondaryColor,
              }}
              name={
                playingState === 'Playing' ? 'stop-circle' : 'play-circle'}
            />
            <ButtonWithCenteredText
              loading={loading}
              containerStyle={{
                flex: 1,
                marginTop: 0,
                marginBottom: 0,
                opacity: saveButtonEnabled ? 1 : 0.2,
              }}
              onPress={async () => {
                if (!saveButtonEnabled) {
                  return;
                }

                await save();
              }}
            >
              Save
            </ButtonWithCenteredText>
            <ButtonWithCenteredText
              loading={loading}
              containerStyle={{
                flex: 1,
                marginTop: 0,
                marginBottom: 0,
                opacity: discardButtonEnabled ? 1 : 0.2,
              }}
              secondary={true}
              onPress={async () => {
                if (!discardButtonEnabled) {
                  return;
                }

                await discard();
              }}
            >
              {memoryState === 'Saved' ? 'Delete' : 'Discard'}
            </ButtonWithCenteredText>
          </View>
        </View>
      </View>
      <DefaultText>
        <DefaultText style={{ fontWeight: '700' }}>
          Status: {}
        </DefaultText>
        {formattedStatus}
      </DefaultText>
    </View>
  );
};

export { AudioBio };
