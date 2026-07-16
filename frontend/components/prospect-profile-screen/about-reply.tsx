import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  TextInput,
  View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { DefaultText, defaultFontFamily, defaultFontSize } from '../default-text';
import { useAppTheme } from '../../app-theme/app-theme';
import { setQuote } from '../conversation-screen/quote';
import { AboutReplyHint } from './about-reply-hint';

const WebAboutText = ({
  name,
  about,
  color,
}: {
  name: string,
  about: string,
  color: string,
}) => {
  const ref = useRef<View>(null);
  const isFocused = useIsFocused();

  // Only track selections while this profile is the focused screen. The
  // Conversation Screen gets pushed on top of this profile, which stays mounted
  // underneath; if the listener stayed active, focusing/typing in the message
  // box would collapse the document selection, fire the handler, and wipe the
  // very quote we navigated there to send.
  useEffect(() => {
    if (!isFocused) return;

    const handler = () => {
      const selection = window.getSelection?.();
      const node = ref.current as unknown as Node | null;

      if (!selection || selection.isCollapsed || !node) {
        setQuote(null);
        return;
      }

      const within =
        (!!selection.anchorNode && node.contains(selection.anchorNode)) ||
        (!!selection.focusNode && node.contains(selection.focusNode));

      if (within) {
        setQuote({
          text: selection.toString(),
          attribution: name,
        });
      } else {
        setQuote(null);
      }
    };

    document.addEventListener('selectionchange', handler);

    return () => document.removeEventListener('selectionchange', handler);
  }, [isFocused, name]);

  return (
    <View ref={ref}>
      <DefaultText style={{ color }} selectable={true}>
        {about}
      </DefaultText>
    </View>
  );
};

const NativeAboutText = ({
  name,
  about,
  color,
}: {
  name: string,
  about: string,
  color: string,
}) => {
  const noEditProps = Platform.OS === 'android'
    ? {
        editable: true,
        showSoftInputOnFocus: false,
        caretHidden: true,
        onChangeText: () => {},
      }
    : {
        editable: false,
      };

  return (
    <TextInput
      value={about}
      multiline={true}
      scrollEnabled={false}
      onSelectionChange={(e) => {
        const { start, end } = e.nativeEvent.selection;
        const a = Math.min(start, end);
        const b = Math.max(start, end);
        if (a === b) {
          setQuote(null);
        } else {
          setQuote({ text: about.slice(a, b), attribution: name });
        }
      }}
      style={{
        color,
        fontFamily: defaultFontFamily,
        fontSize: defaultFontSize,
        padding: 0,
        margin: 0,
        textAlignVertical: 'top',
        includeFontPadding: false,
      }}
      {...noEditProps}
    />
  );
};

const AboutText = ({
  name,
  about,
  color,
  canReply = false,
}: {
  name: string,
  about: string,
  color: string | undefined,
  canReply?: boolean,
}) => {
  const { appTheme } = useAppTheme();

  const props = {
    name,
    about,
    color: color ?? appTheme.secondaryColor,
  };

  // The main purpose of the remount key is to work around behavior on Android.
  // On Android it becomes impossible to select text on a profile after
  // navigating back to it from a conversation without remounting the text
  // input.
  //
  // It also has the effect of deselecting the highlighted text. That way, the
  // quote is only set when the user has some visual indication of it being set,
  // either on the conversation screen, or the profile.
  const [remountKey, setRemountKey] = useState(0);
  const isFocused = useIsFocused();

  useEffect(() => {
    if (isFocused) {
      setRemountKey((k) => k + 1);
    }
  }, [isFocused]);

  useEffect(() => {
    return () => setQuote(null);
  }, []);

  return (
    <View style={{ position: 'relative', zIndex: 1000, marginBottom: 20 }}>
      {
        Platform.OS === 'web'
          ? <WebAboutText key={remountKey} {...props} />
          : <NativeAboutText key={remountKey} {...props} />
      }
      {canReply && <AboutReplyHint color={props.color} />}
    </View>
  );
};

export {
  AboutText,
};
