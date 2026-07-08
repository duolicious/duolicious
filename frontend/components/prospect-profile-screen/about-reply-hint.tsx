import { useCallback, useEffect, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faHighlighter } from '@fortawesome/free-solid-svg-icons/faHighlighter';
import { faReply } from '@fortawesome/free-solid-svg-icons/faReply';
import { DefaultText } from '../default-text';
import { HintBubble } from '../hint-bubble';
import { useQuote } from '../conversation-screen/quote';
import { seenReplyHint } from '../../kv-storage/seen-reply-hint';

const AboutReplyHint = ({ color }: { color: string }) => {
  const [visible, setVisible] = useState(false);
  const quote = useQuote();
  const isFocused = useIsFocused();

  useEffect(() => {
    let active = true;

    (async () => {
      const alreadySeen = await seenReplyHint();
      if (!active || alreadySeen) return;

      setVisible(true);
    })();

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (quote) {
      seenReplyHint(true);
    }
  }, [Boolean(quote)]);

  useEffect(() => {
    if (!isFocused) {
      setVisible(false);
    }
  }, [isFocused]);

  // ...or by tapping the hint to dismiss it.
  const dismiss = useCallback(() => {
    setVisible(false);
    seenReplyHint(true);
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <HintBubble
      color={color}
      pointerPosition="left"
      style={{ left: 5, right: -5 }}
      onPress={dismiss}
    >
      {(inkColor) => <>
        <FontAwesomeIcon
          icon={quote ? faReply : faHighlighter}
          size={14}
          style={{ color: inkColor }}
        />
        <DefaultText
          style={{
            color: inkColor,
            fontSize: 13,
            flexShrink: 1,
          }}
        >
          {quote
            ? 'Nice! – now press the reply button at the bottom of the screen to quote your selection'
            : 'Highlight any text on this profile to reply to it'}
        </DefaultText>
      </>}
    </HintBubble>
  );
};

export {
  AboutReplyHint,
};
