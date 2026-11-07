import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { DefaultText } from '../default-text';
import { useAppTheme } from '../../app-theme/app-theme';
import { setQuote, setQuoteFromSelection } from '../conversation-screen/quote';
import { AboutReplyHint } from '../hints/about-reply-hint';
import { NativeAboutText } from './native-about-text';

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
      const active = document.activeElement;
      if (
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLInputElement
      ) {
        return;
      }

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

  const textColor = color ?? appTheme.secondaryColor;

  // Regaining focus remounts the text, deselecting it, and clears the quote it
  // fed the reply button. That way, the quote is only set when the user has
  // some visual indication of it being set, either on the conversation screen,
  // or the profile.
  const isFocused = useIsFocused();
  const [focus, setFocus] = useState({ isFocused, remountKey: 0 });
  if (focus.isFocused !== isFocused) {
    setFocus({ isFocused, remountKey: focus.remountKey + (isFocused ? 1 : 0) });
  }
  const { remountKey } = focus;

  useEffect(() => {
    if (!canReply || remountKey === 0) return;
    setQuote(null);
  }, [remountKey]);

  useEffect(() => {
    return () => setQuote(null);
  }, []);

  return (
    <View style={{ position: 'relative', zIndex: 1000, marginBottom: 20 }}>
      {
        Platform.OS === 'web'
          ? <WebAboutText key={remountKey} name={name} about={about} color={textColor} />
          : <NativeAboutText
              key={remountKey}
              about={about}
              color={textColor}
              onSelectionChange={isFocused
                ? (selection) => setQuoteFromSelection(about, name, selection)
                : undefined}
            />
      }
      {canReply && <AboutReplyHint color={textColor} />}
    </View>
  );
};

export {
  AboutText,
};
