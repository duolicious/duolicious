import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useReducer,
} from 'react';
import {
  Platform,
  StyleProp,
  StyleSheet,
  TextStyle,
  TextInputProps,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated, {
  AnimatedStyle,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  runOnJS,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import {
  ComposedGesture,
  Gesture,
  GestureDetector,
  Pressable,
} from 'react-native-gesture-handler';
import { LayoutChangeEvent } from 'react-native';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DefaultText } from '../default-text';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faPaperPlane } from '@fortawesome/free-solid-svg-icons/faPaperPlane';
import { styles as defaultTextInputStyles } from '../default-text-input';
import { DefaultLongTextInput } from '../default-long-text-input';
import { isMobile } from '../../util/util';
import {
  RecordingOptions,
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { uriToBase64 } from '../../api/api';
import { notify } from '../../events/events';
import { ValidationErrorToast } from '../toast';
import { FormattedText } from './chat-message';
import { X } from 'react-native-feather';
import {
  Quote as QuoteType,
  QuoteCard,
  quoteToMessageMarkdown,
  quoteToPreviewMarkdown,
  setQuote,
  useQuote,
} from './quote';
import { Tooltip } from '../tooltip';
import { useAppTheme } from '../../app-theme/app-theme';

type KeyPressEvent = {
  key?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  preventDefault: () => void;
};

// ────────────────────────────────────────────────────────────────
// Behaviour-tuning constants – change these to tweak UX quickly
// ────────────────────────────────────────────────────────────────
const MAX_RECORDING_SECS   = 2 * 60;   // Hard recording limit (seconds)
const MIC_HOLD_DELAY_MS    = 300;      // Long-press threshold to start (ms)
const PAN_CANCEL_THRESHOLD = -150;     // Drag distance to cancel (px)

const recordingOptions: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  web: {
    ...RecordingPresets.HIGH_QUALITY.web,
    mimeType: undefined,
  },
};

// ────────────────────────────────────────────────────────────────
// Finite-state reducer for the recording flow
// ────────────────────────────────────────────────────────────────
type RecordingState = 'idle' | 'pending' | 'recording';

type RecordingAction =
  | { type: 'hold' }
  | { type: 'start' }
  | { type: 'finish' }
  | { type: 'cancel' }
  | { type: 'error' };

// Transition table ─ only the valid moves are listed.
const TRANSITIONS: Record<
  RecordingState,
  Partial<Record<RecordingAction['type'], RecordingState>>
> = {
  idle:      { hold:   'pending' },
  pending:   { start:  'recording', cancel: 'idle', error: 'idle' },
  recording: { finish: 'idle',      cancel: 'idle', error: 'idle' },
} as const;

const recordingReducer = (
  state: RecordingState,
  action: RecordingAction
): RecordingState =>
  TRANSITIONS[state][action.type] ?? state;   // default: stay where we are

// Helper that triggers a short, heavy haptic feedback whenever the user starts/stops/cancels
// a recording **as long as we are _not_ on the web** (the browser would ignore the call).
// Using a single place for this keeps the UX consistent and avoids repetition.
const haptics = () => {
  if (Platform.OS !== 'web') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  }
};

// Simple hook that exposes the rendered width of a component (we need this to know how far
// to slide the text input out of the way when recording starts).
const useComponentWidth = () => {
  const [width, setWidth] = useState(0);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width } = event.nativeEvent.layout;
    setWidth(width);
  }, []);

  return { width, onLayout };
};

// ────────────────────────────────────────────────────────────────────────────────
// useRecorder ─ encapsulates everything related to audio recording life-cycle
// ────────────────────────────────────────────────────────────────────────────────
//  • Requests / verifies microphone permission and surfaces **permission errors**
//    through a toast so the user understands why recording failed.
//  • Starts a HIGH_QUALITY recording session (with platform specific overrides).
//  • Exposes a reactive `duration` (in seconds) so the UI can show a timer.
//  • Enforces a hard limit (`maxDuration`) and gracefully stops when reached.
//  • Converts the final file to a base-64 data-uri so callers can POST it without
//    having to deal with the file-system.
//
//  NOTE: We purposefully keep mutable `recordingActive` ref so we can
//  *synchronously* know if a session is live from gesture callbacks that
//  run on the UI thread.
const useRecorder = () => {
  const recorder = useAudioRecorder(recordingOptions);
  const recorderState = useAudioRecorderState(recorder, 250);
  const recordingActive = useRef(false);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (!recorderState.isRecording) {
      return;
    }

    const seconds = Math.floor(recorderState.durationMillis / 1000);

    setDuration(seconds);

    if (seconds >= MAX_RECORDING_SECS) {
      stopRecording();
    }
  }, [recorderState.durationMillis, recorderState.isRecording]);

  const startRecording = async (): Promise<boolean> => {
    if (recorder.isRecording) {
      return true;
    }

    try {
      recordingActive.current = true;

      if ((await getRecordingPermissionsAsync())?.status === 'granted') {
        ;
      } else if ((await requestRecordingPermissionsAsync()).status === 'granted') {
        // Permission was granted but the recording shouldn't start until the
        // user repeats the gesture to start the recording
        recordingActive.current = false;
      } else {
        // Permission denied or dismissed permanently
        recordingActive.current = false;
        notify<React.FC>(
          'toast',
          () => <ValidationErrorToast error="You need to give permission to record audio" />
        );
      }

      // The value of `recordingActive` might've changed while we were waiting
      // for the user to respond to our request for permissions.
      if (!recordingActive.current) {
        return false;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await recorder.prepareToRecordAsync(recordingOptions);
      recorder.record();
      setDuration(0);

      return true;
    } catch (err) {
      notify<React.FC>(
        'toast',
        () => <ValidationErrorToast error={String(err)} />
      );
    }

    return false;
  };

  const stopRecording = async () => {
    recordingActive.current = false;

    if (!recorder.isRecording) {
      return null;
    }

    await recorder.stop();

    await setAudioModeAsync({ allowsRecording: false });

    const uri = recorder.uri;

    if (!uri) {
      console.error('Recording URI was unexpectedly null');
      return null;
    }

    return `data:audio/*;base64,${await uriToBase64(uri)}`;
  };

  return { startRecording, stopRecording, duration };
};

const AutoResizingTextInput = (props: TextInputProps) => {
  const { height } = useWindowDimensions();

  type WebTextInputStyle = TextStyle & {
    outline?: string;
  };

  const inputOverlayStyle: StyleProp<WebTextInputStyle> = {
    outline: 'none',
    position: 'absolute',
    top: Platform.OS === 'web' ? 5 : 4,
    bottom: 0,
    left: 0,
    right: 0,
  };
  const inputStyle = StyleSheet.flatten([props.style, inputOverlayStyle]);

  return (
    <View style={{ flex: 1, maxHeight: height / 4 }}>
      <DefaultText
        style={{
          zIndex: -1,
          flexWrap: 'wrap',
          width: '100%',
          minHeight: 30,
          opacity: 0,
          fontSize: defaultTextInputStyles.textInput.fontSize,
          paddingTop: Platform.OS === 'web' ? 5 : 4,
        }}
      >
        {props.value}
      </DefaultText>
      <DefaultLongTextInput
        {...props}
        style={inputStyle}
      />
    </View>
  );
};

const QuotePreview = ({ quote }: { quote: QuoteType | null }) => {
  const { appTheme } = useAppTheme();

  if (!quote) {
    return null;
  };

  return (
    <Animated.View
      style={{
        width: '100%',
        maxWidth: 600,
        alignSelf: 'center',
        padding: 10,
        paddingBottom: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: appTheme.primaryColor,
        zIndex: -1,
      }}
    >
      <View style={{ flex: 1 }}>
        <FormattedText
          text={quoteToPreviewMarkdown(quote)}
          backgroundColor="#eee"
        />
      </View>
      <Pressable onPress={() => setQuote(null)} style={{ cursor: 'pointer' }}>
        <X
          strokeWidth={3}
          stroke={appTheme.secondaryColor}
          height={26}
          width={26}
        />
      </Pressable>
    </Animated.View>
  )
};

// ────────────────────────────────────────────────────────────────────────────────
// CancelOverlay – timer & “slide to cancel” prompt shown while recording
// ────────────────────────────────────────────────────────────────────────────────
const CancelOverlay = ({
  isRecording,
  animatedTimerStyle,
  animatedCancelMicrophoneStyle,
  animatedCancelTextStyle,
  animatedArrowStyle,
  duration,
  formatTime,
}: {
  isRecording: boolean;
  animatedTimerStyle: AnimatedStyle<ViewStyle>;
  animatedCancelMicrophoneStyle: AnimatedStyle<ViewStyle>;
  animatedCancelTextStyle: AnimatedStyle<ViewStyle>;
  animatedArrowStyle: AnimatedStyle<TextStyle>;
  duration: number;
  formatTime: (s: number) => string;
}) => {
  const { appTheme } = useAppTheme();

  if (!isRecording) return null;

  return (
    <View style={styles.cancelOverlay}>
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            gap: 10,
            zIndex: 999,
            height: '100%',
            alignItems: 'center',
            backgroundColor: appTheme.primaryColor,
          },
          animatedTimerStyle
        ]}
      >
        <Animated.View style={animatedCancelMicrophoneStyle}>
          <Ionicons name="mic" style={styles.cancelMicrophoneStyle} />
        </Animated.View>
        <DefaultText style={[styles.recordingText, styles.recordingTimer]}>
          {formatTime(duration)}
        </DefaultText>
      </Animated.View>

      <Animated.View style={[styles.cancelTextStyle, animatedCancelTextStyle]}>
        <DefaultText style={styles.recordingText}>Slide to cancel</DefaultText>
        <DefaultText animated style={styles.arrowText} animatedStyle={animatedArrowStyle}>←</DefaultText>
      </Animated.View>
    </View>
  );
};

// ────────────────────────────────────────────────────────────────────────────────
// IconBar – microphone button (with gestures) + send paper-plane + hint tooltip
// ────────────────────────────────────────────────────────────────────────────────
const IconBar = ({
  showHint,
  finalGesture,
  animatedRecordingStyle,
  textHasContent,
  handleSendPress,
}: {
  showHint: boolean;
  finalGesture: ComposedGesture;
  animatedRecordingStyle: AnimatedStyle<ViewStyle>;
  textHasContent: boolean;
  handleSendPress: () => void;
}) => {
  const { appTheme } = useAppTheme();

  return (
    <View style={styles.iconContainer}>
      {showHint && (
        <View style={styles.hintContainer}>
          <Tooltip style={styles.hintText}>Hold to record, release to send</Tooltip>
        </View>
      )}

      <GestureDetector gesture={finalGesture}>
        <Animated.View style={[styles.microphoneIcon, animatedRecordingStyle]}>
          <Ionicons name="mic" style={{ fontSize: 28, color: appTheme.secondaryColor }} />
        </Animated.View>
      </GestureDetector>

      {textHasContent && (
        <Pressable onPress={handleSendPress} style={styles.sendPressable}>
          <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.sendAnimated}>
            <FontAwesomeIcon
              icon={faPaperPlane}
              size={20}
              color="#70f"
              // @ts-ignore – 'outline' is a web-only style prop
              style={{ marginRight: 5, marginBottom: 5, outline: 'none' }}
            />
          </Animated.View>
        </Pressable>
      )}
    </View>
  );
};

// ────────────────────────────────────────────────────────────────────────────────
// <Input /> component – this is the heart of the chat composer.
// ────────────────────────────────────────────────────────────────────────────────
//  Layout overview:
//  ┌──────────────────────────────────────────────────────────────────────────┐
//  │  TextInput  |  GIF button  |  (hidden) cancel-overlay                    │
//  └──────────────────────────────────────────────────────────────────────────┘
//                                   │
//  ┌──────────────────────────────────────────────────────────────────────────┐
//  │  Mic / Send button (overlaps, fades in/out)                             │
//  └──────────────────────────────────────────────────────────────────────────┘
//
//  Interaction matrix:
//  ────────────────────────────────────────────────────────────────────────────
//   Tap mic   → show hint ("Hold to record")
//   Hold mic  → start recording (after 300 ms) & slide input left
//   Drag left → live-update mic position, if >150 px → **cancel** recording
//   Release    ├─ if cancelled → discard
//              └─ else → stop & emit audio (≥1 s)
//  Errors (permission denied, unexpected exceptions) are surfaced immediately
//  via `ValidationErrorToast` so the user gets feedback without breaking flow.
//
//  Animation strategy:
//  • All transient UI state (widths, translations, opacity, timers…) lives in
//    Reanimated **shared values** so it can be mutated from the worklet side
//    inside gesture handlers without causing React renders.
//  • When `isRecording` flips we kick off `withTiming`/`withRepeat` sequences
//    to move the input out, reveal the cancel overlay, flash the red mic, and
//    run the “slide to cancel” arrow.
//  • The overlay re-uses the same `cancelTextTranslateX` shared value that the
//    input container animates with – that guarantees both elements stay in
//    perfect sync regardless of screen width.
//
//  High-level data-flow:
//     Gestures  ──→ SharedValues ──→ AnimatedStyles ──→ Rendered UI
//                      ▲                                   │
//                      │                                   ▼
//                useRecorder (timer & async events) ── setState/props
//
const Input = ({
  initialValue = '',
  onPressSend,
  onChange,
  onPressGif,
  onAudioComplete,
  onFocus,
}: {
  initialValue?: string
  onPressSend: (text: string, card?: QuoteCard) => void
  onChange: (s: string) => void
  onPressGif: () => void
  onAudioComplete: (audioBase64: string) => void
  onFocus: () => void,
}) => {
  const { appTheme } = useAppTheme();

  const quote = useQuote();

  const [text, setText] = useState(initialValue ?? '');

  const [recordingState, dispatchRecording] = useReducer(recordingReducer, 'idle');
  const isRecording = recordingState === 'recording';
  const [showHint, setShowHint] = useState(false);

  const { width, onLayout } = useComponentWidth();

  const { startRecording, stopRecording, duration } = useRecorder();

  // ────────────────────────────────
  // Shared animation state (Reanimated)
  // ────────────────────────────────
  // All of the following `useSharedValue` calls create values that can be read
  // and mutated from worklet context (e.g. inside gesture handlers). This keeps
  // every frame on the UI thread and avoids the overhead of React state
  // updates during high-frequency interactions such as drags.

  // Shared value for GIF container width.
  const gifWidth = useSharedValue(40);
  // Shared value for horizontal translation of the mic during pan.
  const recordTranslateX = useSharedValue(0);
  // Shared value for opacity of the mic during recording.
  const recordOpacity = useSharedValue(1);
  // Shared flag to detect cancellation immediately.
  const cancelTriggered = useSharedValue(false);
  // Shared values for animating the input area and cancel overlay.
  const inputTranslateX = useSharedValue(0);
  const cancelTextTranslateX = useSharedValue(width); // initial offset

  // Shared value for arrow translation.
  const arrowTranslateX = useSharedValue(0);

  const microphoneOpacity = useSharedValue(1);
  // New shared values for cancellation animation on the red mic in the overlay.
  const micRotation = useSharedValue(0);
  const micTranslateY = useSharedValue(0);

  // Animate the GIF container based on text input.
  useEffect(() => {
    if (text.length > 0) {
      gifWidth.value = withTiming(0);
    } else {
      gifWidth.value = withTiming(40);
    }
  }, [text, gifWidth]);

  // Animate UI elements based on the *actual* recording state.
  useEffect(() => {
    if (isRecording) {
      inputTranslateX.value = withTiming(-width);
      cancelTextTranslateX.value = withTiming(0);
      recordOpacity.value = withTiming(isMobile() ? 0 : 0.3);
    } else {
      inputTranslateX.value = withTiming(0);
      cancelTextTranslateX.value = withTiming(width);
      recordOpacity.value = withTiming(1);
      recordTranslateX.value = withTiming(0);
    }
  }, [isRecording, inputTranslateX, cancelTextTranslateX, width]);

  // Animate arrow suggestion when recording is active.
  useEffect(() => {
    if (isRecording) {
      arrowTranslateX.value = withRepeat(
        withTiming(-10, { duration: 1000 }),
        -1,
        true
      );

      microphoneOpacity.value = withRepeat(
        withTiming(0, { duration: 700 }),
        -1,
        true
      );
    } else {
      arrowTranslateX.value = 0;
      microphoneOpacity.value = 1;
    }
  }, [isRecording, arrowTranslateX]);

  useEffect(() => {
    return () => setQuote(null);
  }, []);

  // Helper to format seconds as mm:ss.
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  // ──────────────────────────────────────────────────────────────────────
  // AnimatedStyle hooks – declaratively bind shared values to view props
  // ──────────────────────────────────────────────────────────────────────
  // Each hook maps an *input* (shared value) to an *output* (style object).
  // We never mutate the styles directly; instead we nudge the shared values
  // and let Reanimated update the view on the UI thread.

  const animatedGifStyle = useAnimatedStyle(() => ({
    width: gifWidth.value,
    opacity: gifWidth.value / 40,
  }));

  const animatedInputStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: inputTranslateX.value }],
  }));

  // Timer (and red mic) overlay uses only the base overlay translation.
  const animatedTimerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: cancelTextTranslateX.value }],
  }));

  // Animated style for the red flashing microphone in the overlay.
  const animatedCancelMicrophoneStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${micRotation.value}deg` },
      { translateY: micTranslateY.value },
    ],
    opacity: microphoneOpacity.value,
  }));

  // The "Slide to cancel" text and arrow add the mic's drag translation.
  const animatedCancelTextStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: cancelTextTranslateX.value + recordTranslateX.value }],
  }));

  // The microphone in the icon container only follows the drag.
  const animatedRecordingStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: recordTranslateX.value }],
    opacity: recordOpacity.value,
  }));

  // Animated style for the arrow suggestion.
  const animatedArrowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: arrowTranslateX.value }],
  }));

  // ------------------------------------------------------------------
  // Recording life-cycle handlers (called from gesture worklets via runOnJS)
  // ------------------------------------------------------------------
  // We keep these separate from the gesture definitions so they stay readable
  // and can be unit-tested if needed.

  // Try to begin recording – only mark `isRecording` true once we actually
  // have a recording session running.
  const handleStartRecording = () => {
    cancelTriggered.value = false;
    // Reset cancellation animation values.
    micRotation.value = 0;
    micTranslateY.value = 0;
    haptics();

    // We are in long-press hold → pending state
    dispatchRecording({ type: 'hold' });

    startRecording().then((didStart) => {
      if (didStart) {
        // Real recording session started → trigger UI/animation state.
        dispatchRecording({ type: 'start' });
      } else {
        // Permission denied or other failure – make sure mic snaps back.
        recordTranslateX.value = withTiming(0);
        dispatchRecording({ type: 'error' });
      }
    });
  };

  const handleFinishRecording = () => {
    // Grab current state before we flip it so we know if a recording was live.
    const wasRecording = isRecording;

    dispatchRecording({ type: 'finish' });
    haptics();
    // Always reset the mic position.
    recordTranslateX.value = withTiming(0);

    (async () => {
      // Stop the recorder no matter what – it is safe to call even if it
      // never started.
      const base64 = await stopRecording();

      // Only emit the audio if we were actually recording and we captured
      // something of reasonable length.
      if (wasRecording && base64 && duration >= 1) {
        onAudioComplete(base64);
      }
    })();
  };

  const handleCancelRecording = () => {
    cancelTriggered.value = true;
    // Animate the red mic in the overlay: rotate and jump, then fall.
    microphoneOpacity.value = withTiming(1);
    micRotation.value = withTiming(-180, { duration: 500 });
    micTranslateY.value = withSequence(
      withTiming(   0, { duration: 500 }),
      withTiming(-300, { duration: 500 }),
    );
    haptics();
    // Always snap the mic back.
    recordTranslateX.value = withTiming(0);
    // Stop and discard any recording.
    stopRecording();
    setTimeout(() => dispatchRecording({ type: 'cancel' }), 1000);
  };

  const handleFailedTap = () => {
    setShowHint(true);
    haptics();
    setTimeout(() => setShowHint(false), 2000);
  };

  const handleSendPress = () => {
    const trimmedText = text.trim();
    const quoteAsMarkdown = quoteToMessageMarkdown(quote);
    const card = quote?.card;

    if (trimmedText.length === 0) {
      return;
    }

    setText('');
    setQuote(null);

    if (trimmedText.length > 0 && quoteAsMarkdown.length > 0) {
      onPressSend(quoteAsMarkdown + '\n' + trimmedText, card);
    } else if (trimmedText.length > 0) {
      onPressSend(trimmedText);
    }
  };

  const handleTextChange = (newText: string) => {
    setText(newText);
    onChange(newText);
  };

  const handleKeyPress = (event: KeyPressEvent) => {
    if (
      !isMobile() &&
      event.key === 'Enter' &&
      (event.ctrlKey || event.altKey)
    ) {
      event.preventDefault();
      setText((text) => text + "\n");
    } else if (
      !isMobile() &&
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      handleSendPress();
    }
  };

  // Tap gesture: quick press shows the hint for 2 seconds.
  const tapGesture = Gesture.Tap()
    .maxDuration(300)
    .onEnd(() => {
      runOnJS(handleFailedTap)();
    });

  // Create a long press gesture to trigger recording.
  const longPressGesture = Gesture.LongPress()
    .minDuration(MIC_HOLD_DELAY_MS)
    .onStart(() => {
      runOnJS(handleStartRecording)();
    })
    .onEnd((_, success) => {
      if (success && !cancelTriggered.value) {
        runOnJS(handleFinishRecording)();
      }
    });

  // Create a pan gesture to let the user slide the mic leftwards.
  const panGesture = Gesture.Pan()
    .onStart(() => {
      cancelTriggered.value = false;
    })
    .onChange((event) => {
      if (!cancelTriggered.value) {
        recordTranslateX.value = Math.min(0, event.translationX);
      }
      if (event.translationX < PAN_CANCEL_THRESHOLD && !cancelTriggered.value) {
        runOnJS(handleCancelRecording)();
      }
    })
    .onEnd(() => {
      if (!cancelTriggered.value) {
        runOnJS(handleFinishRecording)();
      }
    });

  // Combine the long press and pan gestures so they work on the same element.
  const combinedGesture = Gesture.Simultaneous(longPressGesture, panGesture);
  const finalGesture = Gesture.Exclusive(tapGesture, combinedGesture);

  return (
    <KeyboardAvoidingView behavior="padding">
      <QuotePreview quote={quote} />
      <View
        style={[
          styles.container,
          { backgroundColor: appTheme.primaryColor }
        ]}
        onLayout={onLayout}
      >
        {/* Input wrapper: position relative so we can overlay the cancel overlay */}
        <View style={styles.inputWrapper}>
          <Animated.View
            style={[
              {
                flexDirection: 'row',
                alignItems: 'center',
                borderRadius: 10,
                paddingHorizontal: Platform.OS === 'web' ? 10 : 8,
                paddingVertical: Platform.OS === 'web' ? 10 : 6,
                backgroundColor: appTheme.inputColor,
              },
              animatedInputStyle
            ]}
          >
            <AutoResizingTextInput
              style={styles.textInput}
              multiline={true}
              placeholder="Type a message..."
              value={text}
              onChangeText={handleTextChange}
              onKeyPress={handleKeyPress}
              onFocus={onFocus}
            />
            <Pressable onPress={onPressGif} hitSlop={10}>
              <Animated.View
                style={[
                  {
                    height: 28,
                    justifyContent: 'center',
                    alignItems: 'center',
                    overflow: 'hidden',
                    borderRadius: 5,
                    borderWidth: 3,
                    borderColor: appTheme.secondaryColor,
                  },
                  animatedGifStyle,
                ]}
              >
                <DefaultText
                  style={styles.gifText}
                  numberOfLines={1}
                  ellipsizeMode="clip"
                >
                  GIF
                </DefaultText>
              </Animated.View>
            </Pressable>
          </Animated.View>
          <CancelOverlay
            isRecording={isRecording}
            animatedTimerStyle={animatedTimerStyle}
            animatedCancelMicrophoneStyle={animatedCancelMicrophoneStyle}
            animatedCancelTextStyle={animatedCancelTextStyle}
            animatedArrowStyle={animatedArrowStyle}
            duration={duration}
            formatTime={formatTime}
          />
        </View>
        <IconBar
          showHint={showHint}
          finalGesture={finalGesture}
          animatedRecordingStyle={animatedRecordingStyle}
          textHasContent={text.trim().length !== 0}
          handleSendPress={handleSendPress}
        />
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputWrapper: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  textInput: {
    backgroundColor: undefined,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    paddingRight: 0,
    marginLeft: undefined,
    marginRight: undefined,
    borderColor: undefined,
    borderWidth: undefined,
    borderRadius: undefined,
    height: undefined,
    flex: 1,
  },
  gifContainer: {
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderRadius: 5,
    borderWidth: 3,
    borderColor: 'black',
  },
  gifText: {
    fontSize: 16,
    fontWeight: 900,
    overflow: 'hidden',
    // @ts-ignore
    whiteSpace: 'nowrap',
    textOverflow: 'clip',
  },
  cancelOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingTimer: {
    width: 50,
  },
  cancelTextStyle: {
    flexDirection: 'row',
    height: '100%',
    alignItems: 'center',
  },
  recordingText: {
    fontSize: 16,
  },
  arrowText: {
    marginLeft: 20,
    fontSize: 18,
  },
  iconContainer: {
    width: 40,
    height: 40,
    marginLeft: 5,
    position: 'relative',
  },
  microphoneIcon: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendPressable: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  sendAnimated: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgb(228, 204, 255)',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#70f',
  },
  hintContainer: {
    position: 'absolute',
    bottom: 36,
    right: 22,
    width: 300,
    zIndex: 1000,
  },
  hintText: {
    borderBottomRightRadius: 2,
    color: 'white',
    flexShrink: 1,
    alignSelf: 'flex-end',
  },
  cancelMicrophoneStyle: {
    fontSize: 28,
    color: 'crimson',
  },
});

export { Input };
