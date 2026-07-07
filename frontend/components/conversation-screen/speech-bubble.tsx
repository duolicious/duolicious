import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  Linking,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { DefaultText } from '../default-text';
import { longFriendlyTimestamp } from '../../util/util';
import { Image } from 'expo-image';
import { IMAGES_URL } from '../../env/env';
import { AutoResizingGif } from '../auto-resizing-gif';
import { isMobile } from '../../util/util';
import { AudioPlayer } from '../audio-player';
import { MessageStatus } from '../../chat/application-layer';
import { useMessage } from '../../chat/application-layer/hooks/message';
import {
  sendReactionAndNotify,
  useReaction,
} from '../../chat/application-layer/hooks/reaction';
import { onReceiveMessage, Message } from '../../chat/application-layer';
import { Gesture, GestureDetector, HandlerStateChangeEvent, TapGestureHandler, TapGestureHandlerEventPayload, State } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { setQuote, parseMarkdown, QuoteBlock, TextBlock } from './quote';
import * as Haptics from 'expo-haptics';
import { useSignedInUser } from '../../events/signed-in-user';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faReply } from '@fortawesome/free-solid-svg-icons/faReply';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootParamList } from '../../navigation/linking';
import { assertNever, formatCount } from '../../util/util';
import { useAppTheme } from '../../app-theme/app-theme';
import {
  ReactionChip,
  ReactionMenu,
} from './reaction-controls';
import { useAnchorMeasurement } from '../anchored-overlay';

const currentUserBackgroundColor = '#70f';

const defaultTextColor = 'black';

const defaultFontSize = 15;

const isSafeImageUrl = (str: string): boolean => {
  // Tenor remains for messages sent before the switch to Klipy
  const urlRegex = /^https:\/\/(media\.tenor\.com|static\.klipy\.com)\/\S+\.(gif|webp)$/i;
  return urlRegex.test(str);
};

const isEmojiOnly = (str: string): boolean => {
  const emojiRegex = /^\p{Emoji_Presentation}+$/u;
  return emojiRegex.test(str);
}

const haptics = () => {
  if (Platform.OS !== 'web') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  }
};

const FormattedQuoteBlock = ({
  block,
  fontSize,
  backgroundColor,
}: {
  block: QuoteBlock,
  fontSize: number,
  backgroundColor: string,
}) => {
  return (
    <DefaultText
      selectable={!isMobile()}
      style={{
        fontSize,
        paddingLeft: 7,
        paddingRight: 10,
        paddingVertical: 8,
        borderLeftWidth: 6,
        borderColor: 'black',
        backgroundColor,
        color: 'black',
        borderRadius: 4,
      }}
    >
      {block.type === "quote" && block?.attribution &&
        <DefaultText
          style={{
            color: 'black',
            fontWeight: '700',
          }}
        >
          {block.attribution}{'\n'}
        </DefaultText>
      }
      {block.text}
    </DefaultText>
  );
};

const FormattedTextBlock = ({
  block,
  color,
  fontSize,
}: {
  block: TextBlock,
  color: string,
  fontSize: number,
}) => {
  return (
    <>
      {block.tokens.map((token, i) => {
        if (token.kind === 'text') {
          return (
            <DefaultText key={i} selectable={!isMobile()} style={{ color, fontSize }}>
              {token.value}
            </DefaultText>
          );
        } else if (token.kind === 'link') {
          const openLink = (url: string) => {
            Linking.openURL(url);
          };

          const gesture = Gesture.Tap().onEnd(() => {
            runOnJS(openLink)(token.url);
          });

          return (
            <GestureDetector key={i} gesture={gesture}>
              <View>
                <DefaultText
                  key={i}
                  style={{
                    color,
                    fontSize,
                    ...styles.hyperlink,
                  }}
                >
                  {token.display}
                </DefaultText>
              </View>
            </GestureDetector>
          );
        } else {
          return assertNever(token);
        }
      })}
    </>
  );
};

const FormattedText = ({
  text,
  color = defaultTextColor,
  fontSize = defaultFontSize,
  backgroundColor = 'rgba(255, 255, 255, 0.8)',
}: {
  text: string
  color?: string,
  fontSize?: number,
  backgroundColor?: string,
}) => {
  const blocks = parseMarkdown(text);

  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === 'quote') {
          return <FormattedQuoteBlock
            key={i}
            block={block}
            fontSize={fontSize}
            backgroundColor={backgroundColor}
          />
        } else if (block.type === 'text') {
          return <FormattedTextBlock
            key={i}
            block={block}
            color={color}
            fontSize={fontSize}
          />
        } else {
          return assertNever(block);
        }
      })}
    </>
  );
};

const MessageStatusComponent = ({
  messageStatus,
  name = 'them',
  usedCount = 0,
}:
  | { name: string | undefined, messageStatus: 'not unique', usedCount: number }
  | { name: string | undefined, messageStatus: Exclude<MessageStatus, 'not unique'>, usedCount?: never }
) => {

  const verificationStatuses: MessageStatus[] =  [
    'rate-limited-1day-unverified-basics',
    'rate-limited-1day-unverified-photos',
    'age-verification',
  ];

  const isPressable = verificationStatuses.includes(messageStatus);

  const navigation = useNavigation<NativeStackNavigationProp<RootParamList>>();

  const onHandlerStateChange = useCallback(({ nativeEvent }: HandlerStateChangeEvent<TapGestureHandlerEventPayload>) => {
    if (!isPressable) {
      return;
    }

    if (nativeEvent.state !== State.ACTIVE) {
      return;
    }

    return navigation.navigate('Home', { screen: 'Profile' });
  }, [isPressable]);

  const verificationMessageText = ` Verification is free and takes just a few minutes. Press here to start.`;

  const messageTexts: Record<MessageStatus, string> = {
    'sending': '',
    'sent': '',
    'timeout': 'Message not delivered. Are you online?',
    'rate-limited-1day-unverified-basics': `You’ve used today’s daily intro limit! Message ${name} tomorrow or unlock extra daily intros by getting verified.` + verificationMessageText,
    'rate-limited-1day-unverified-photos': `You’ve used today’s daily intro limit! Message ${name} tomorrow or unlock extra daily intros by verifying your photos.` + verificationMessageText,
    'rate-limited-1day': `You’ve used today’s daily intro limit! Try messaging ${name} tomorrow...`,
    'voice-intro': `Voice messages aren’t allowed in intros`,
    'spam': `We think that might be spam. Try sending ${name} a different message.`,
    'offensive': `Intros can’t be too rude. Try sending ${name} a different message.`,
    'age-verification': `Verification is required to chat.` + verificationMessageText,
    'blocked': name + ' is unavailable right now. Try messaging someone else!',
    'not unique': `That intro’s been used ${usedCount === 1 ? 'once before' : `${formatCount(usedCount)} times`} on Duolicious. Send ${name} a unique message instead!`,
    'too long': 'That message is too big! 😩',
    'server-error': 'Our server went boom. Please contact support@duolicious.app',
  };

  const messageText = messageTexts[messageStatus];

  if (messageText === '') {
    return <></>;
  }

  return (
    <TapGestureHandler onHandlerStateChange={onHandlerStateChange} >
      <View
        style={{
          borderRadius: 10,
          backgroundColor: 'black',
          padding: 10,
          maxWidth: '80%',
          cursor: isPressable ? 'pointer' : undefined,
        }}
      >
        <DefaultText style={{
          color: 'white',
          fontWeight: 700,
        }}>
          {messageText}
        </DefaultText>
      </View>
    </TapGestureHandler>
  );
};

const SpeechBubble = ({
  messageId,
  name,
  avatarUuid,
}: {
  messageId: string
  name: string | undefined
  avatarUuid: string | null | undefined
}) => {
  const { appTheme } = useAppTheme();
  const opacity = useSharedValue(0);

  const translateX = useSharedValue(0);
  const dragTriggered = useSharedValue(false);

  const [isHovering, setIsHovering] = useState(false);
  const [doShowTimestamp, setDoShowTimestamp] = useState(false);
  const [showReactionBar, setShowReactionBar] = useState(false);
  const [speechBubbleImageError, setSpeechBubbleImageError] = useState(false);
  const {
    anchor: reactionAnchor,
    anchorRef: reactionAnchorRef,
    measureAnchor: measureReactionAnchor,
  } = useAnchorMeasurement();
  const message = useMessage(messageId);
  const [signedInUser] = useSignedInUser();

  const chatMessage =
    message && message.message.type !== 'typing'
      ? message.message
      : undefined;

  const mamId = chatMessage?.mamId;

  const reaction = useReaction(mamId);

  const canReact = !!chatMessage && !chatMessage.fromCurrentUser && !!mamId;

  const pickReaction = useCallback((emoji: string) => {
    setShowReactionBar(false);

    if (!mamId) {
      return;
    }

    const next = reaction?.emoji === emoji ? '' : emoji;

    sendReactionAndNotify(mamId, next);
  }, [mamId, reaction?.emoji]);

  const clearOwnReaction = useCallback(() => {
    if (!mamId || reaction?.reactionFrom !== 'self') {
      return;
    }

    sendReactionAndNotify(mamId, '');
  }, [mamId, reaction?.reactionFrom]);

  const openReactionBar = useCallback(() => {
    haptics();

    measureReactionAnchor();
    setShowReactionBar(true);
  }, [measureReactionAnchor]);

  const doRenderUrlAsImage = (
    message &&
    message.message.type === 'chat-text' &&
    isSafeImageUrl(message.message.text) &&
    !speechBubbleImageError
  );

  const backgroundColor = (() => {
    if (!message) {
      return 'transparent';
    } else if (message.message.type !== 'chat-text') {
      return 'transparent';
    } else if (doRenderUrlAsImage) {
      return 'transparent';
    } else if (isEmojiOnly(message.message.text)) {
      return 'transparent';
    } else if (message.message.fromCurrentUser) {
      return currentUserBackgroundColor;
    } else {
      return appTheme.speechBubbleOtherUserBackgroundColor;
    }
  })();

  const textColor =
    !!message &&
    message.message.type === 'chat-text' &&
    message.message.fromCurrentUser
    ? 'white'
    : appTheme.speechBubbleOtherUserColor;

  const showTimestamp = useCallback(() => {
    setShowReactionBar(false);
    setDoShowTimestamp(t => !t);
  }, [setDoShowTimestamp]);

  const setQuoteToThisSpeechBubble = useCallback(() => {
    if (!message) {
      return;
    }

    if (message.message.type !== 'chat-text') {
      return;
    }

    haptics();

    const text = message.message.text;

    const attribution = !!message && message.message.fromCurrentUser
      ? signedInUser?.name
      : name;

    if (attribution) {
      setQuote({ text, attribution })
    }
  }, [message, signedInUser?.name, name])

  const pan = Gesture
    .Pan()
    .enabled(
      isMobile() &&
      !doRenderUrlAsImage &&
      !!message &&
      message.message.type === 'chat-text'
    )
    .activeOffsetX([-10, 10])
    .onStart(() => {
      dragTriggered.value = false;
    })
    .onUpdate(evt => {
      const x = evt.translationX

      translateX.value = x;

      if (!dragTriggered.value && Math.abs(x) > 50) {
        dragTriggered.value = true;
        runOnJS(setQuoteToThisSpeechBubble)();
      }
    })
    .onEnd(() => {
      dragTriggered.value = false;
      translateX.value = withTiming(0)
    });

  const tap = Gesture
    .Tap()
    .maxDistance(10)
    .enabled(
      !doRenderUrlAsImage &&
      !!message &&
      message.message.type === 'chat-text'
    )
    .onEnd(() => {
      runOnJS(showTimestamp)()
    });

  const longPress = Gesture
    .LongPress()
    .enabled(isMobile() && canReact)
    .minDuration(300)
    .onStart(() => {
      runOnJS(openReactionBar)()
    });

  const gesture = Gesture.Exclusive(longPress, pan, tap);

  const gestureStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const animatedContainerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  useEffect(() => {
    if (message?.status === 'sent') {
      opacity.value = withTiming(1.0);
    } else {
      opacity.value = 0.3;
    }
  }, [message?.status === 'sent']);

  if (!message) {
    return <></>;
  }

  if (message.message.type === 'typing') {
    return <></>;
  }

  return (
    <View
      style={[
        {
          paddingLeft: 10,
          paddingRight: 10,
          alignItems: message.message.fromCurrentUser ? 'flex-end' : 'flex-start',
          width: '100%',
          gap: 4,
          zIndex: showReactionBar || isHovering ? 1 : 0,
        },
      ]}
    >
      <View
        style={{
          position: 'relative',
          width: '100%',
          alignItems: message.message.fromCurrentUser ? 'flex-end' : 'flex-start',
          zIndex: showReactionBar || isHovering ? 1 : 0,
        }}
        /* @ts-ignore */
        onContextMenu={
          canReact && isMobile() && Platform.OS === 'web'
            ? (e: any) => e.preventDefault() // eslint-disable-line @typescript-eslint/no-explicit-any
            : undefined
        }
      >
        <ReactionMenu
          visible={canReact && (showReactionBar || (isHovering && !isMobile()))}
          showDismissLayer={canReact && showReactionBar}
          anchor={reactionAnchor}
          selected={reaction?.emoji}
          onPick={pickReaction}
          onDismiss={() => setShowReactionBar(false)}
          onHoverChange={isMobile() ? undefined : setIsHovering}
        />
        <GestureDetector
          gesture={gesture}
          touchAction="pan-y"
        >
          <Animated.View
            ref={reactionAnchorRef}
            style={[
              {
                flexDirection: 'row',
                gap: 5,
                alignItems: 'flex-end',
                ...(doRenderUrlAsImage ? {
                  width: '66%',
                }: {
                  maxWidth: '80%',
                })
              },
              animatedContainerStyle,
              gestureStyle
            ]}
          >
            {!message.message.fromCurrentUser && avatarUuid &&
              <Image
                source={{ uri: `${IMAGES_URL}/450-${avatarUuid}.jpg` }}
                transition={150}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 9999,
                }}
              />
            }
            {message.message.type === 'chat-text' &&
              <View
                style={{
                  borderRadius: 10,
                  backgroundColor: backgroundColor,
                  gap: 10,
                  ...(doRenderUrlAsImage ? {
                    width: '100%',
                  }: {
                    padding: 10,
                    flexShrink: 1,
                  }),
                  overflow: 'hidden',
                }}
                /* @ts-ignore */
                onMouseEnter={() => {
                  measureReactionAnchor();
                  setIsHovering(true);
                }}
                onMouseLeave={() => setIsHovering(false)}
                /* @ts-ignore */
                onClick={isMobile() ? undefined : () => {
                  if (window.getSelection()?.toString()) {
                    return;
                  }
                  showTimestamp();
                }}
              >
                {doRenderUrlAsImage &&
                  <AutoResizingGif
                    uri={message.message.text}
                    onError={() => setSpeechBubbleImageError(true)}
                    requirePress={isMobile()}
                  />
                }
                {!doRenderUrlAsImage &&
                  <FormattedText
                    text={message.message.text}
                    color={textColor}
                    fontSize={isEmojiOnly(message.message.text) ? 50 : defaultFontSize}
                  />
                }
                {!doRenderUrlAsImage && !isMobile() &&
                  <View
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      height: 32,
                      width: 32,
                      opacity: isHovering ? 1 : 0,
                      borderBottomLeftRadius: 10,
                      backgroundColor,
                      justifyContent: 'center',
                      alignItems: 'center',
                      cursor: 'pointer',
                    }}
                    /* @ts-ignore */
                    onClick={(e) => {
                      e.stopPropagation();
                      setQuoteToThisSpeechBubble();
                    }}
                  >
                    <FontAwesomeIcon
                      icon={faReply}
                      size={20}
                      color={textColor}
                      style={{
                        /* @ts-ignore */
                        outline: 'none',
                      }}
                    />
                  </View>
                }
              </View>
            }
            {message.message.type === 'chat-audio' &&
              <AudioPlayer
                sending={message.status === 'sending'}
                uuid={message.message.audioUuid}
                presentation="conversation"
              />
            }
          </Animated.View>
        </GestureDetector>
      </View>
      {reaction &&
        <ReactionChip
          emoji={reaction.emoji}
          alignSelf={message.message.fromCurrentUser ? 'flex-end' : 'flex-start'}
          onPress={reaction.reactionFrom === 'self' ? clearOwnReaction : undefined}
        />
      }
      {doShowTimestamp &&
        <DefaultText
          selectable={true}
          style={{
            fontSize: appTheme.timestampFontSize,
            alignSelf: message.message.fromCurrentUser ? 'flex-end' : 'flex-start',
            color: appTheme.hintColor,
          }}
        >
          Delivered {longFriendlyTimestamp(message.message.timestamp)}
        </DefaultText>
      }
      <MessageStatusComponent
        name={name}
        {...(message.status === 'not unique'
          ? { messageStatus: message.status, usedCount: message.usedCount }
          : { messageStatus: message.status }
        )}
      />
    </View>
  );
};

const TypingSpeechBubble = ({
  personUuid,
  avatarUuid,
}: {
  personUuid: string
  avatarUuid: string | null | undefined
}) => {
  const { appTheme } = useAppTheme();

  const opacity = useSharedValue(0.0);
  const progress = useSharedValue(0);

  useEffect(() => {
    return onReceiveMessage(
      (message: Message) => {
        // Cancel any ongoing animation (including a pending fade-out)
        cancelAnimation(opacity);

        if (message.type === 'typing') {
          opacity.value = withSequence(
            withTiming(1),
            withDelay(5000, withTiming(0))
          );
        } else {
          opacity.value = withTiming(0);
        }
      },
      personUuid
    );
  }, [personUuid]);

  // Only run the dot animation while visible
  useAnimatedReaction(
    () => opacity.value,
    (current, previous) => {
      if (current > 0 && (previous ?? 0) === 0) {
        // Start the repeating animation when bubble becomes visible
        progress.value = withRepeat(
          withTiming(1, { duration: 2000, easing: Easing.linear }),
          -1,
          false
        );
      } else if (current === 0 && (previous ?? 0) > 0) {
        // Stop the animation when bubble is no longer visible
        cancelAnimation(progress);
        progress.value = 0;
      }
    }
  );

  const animatedContainerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const Dot = ({ phaseOffset }: { phaseOffset: number }) => {
    const animatedStyle = useAnimatedStyle(() => ({
      opacity: 0.5 + 0.5 * Math.sin(2 * Math.PI * (phaseOffset - progress.value))
    }));
    return <Animated.View
      style={[
        styles.dot,
        { backgroundColor: appTheme.speechBubbleOtherUserColor },
        animatedStyle
      ]}
    />;
  };

  return (
    <Animated.View style={[styles.speechBubbleContainer, animatedContainerStyle]}>
      <View
        style={{
          flexDirection: 'row',
          gap: 5,
          alignItems: 'flex-end',
          maxWidth: '80%',
        }}
      >
        {avatarUuid &&
          <Image
            source={{ uri: `${IMAGES_URL}/450-${avatarUuid}.jpg` }}
            transition={150}
            style={{
              width: 24,
              height: 24,
              borderRadius: 9999,
            }}
          />
        }
        <View
          style={{
            borderRadius: 10,
            backgroundColor: appTheme.speechBubbleOtherUserBackgroundColor,
            gap: 5,
            paddingVertical: 14,
            paddingHorizontal: 12,
            flexShrink: 1,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Dot phaseOffset={0} />
          <Dot phaseOffset={0.33} />
          <Dot phaseOffset={0.66} />
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  speechBubbleContainer: {
    paddingLeft: 10,
    paddingRight: 10,
    alignItems: 'flex-start',
    flex: 1,
    gap: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  hyperlink: {
    textDecorationLine: 'underline',
    cursor: 'pointer',
  }
});

export {
  FormattedText,
  SpeechBubble,
  TypingSpeechBubble,
};
