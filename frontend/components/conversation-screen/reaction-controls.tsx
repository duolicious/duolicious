import { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleProp,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  FadeInUp,
  FadeOutDown,
  FadeOutUp,
} from 'react-native-reanimated';
import { DefaultText } from '../default-text';
import {
  useAppTheme,
} from '../../app-theme/app-theme';
import type { AppTheme } from '../../app-theme/app-theme';
import {
  AnchorMeasurement,
  AnchoredOverlay,
  aboveAnchorStyle,
  useWindowOverlayDimensions,
} from '../anchored-overlay';

const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '👎'];
const REACTION_BAR_ANIMATION_DURATION = 100;
const REACTION_BAR_ESTIMATED_WIDTH = 220;
const REACTION_BAR_ESTIMATED_HEIGHT = 44;
const SCREEN_EDGE_PADDING = 8;
const TOP_NAV_ESTIMATED_HEIGHT = 50;

const reactionPillChrome = (appTheme: AppTheme) => ({
  backgroundColor: appTheme.reactionBarBackgroundColor,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: appTheme.reactionBarBorderColor,
  paddingHorizontal: 6,
});

const ReactionBar = ({
  selected,
  onPick,
}: {
  selected: string | undefined,
  onPick: (emoji: string) => void,
}) => {
  const { appTheme } = useAppTheme();
  return (
    <View
      style={{
        ...reactionPillChrome(appTheme),
        flexDirection: 'row',
        gap: 2,
        paddingVertical: 4,
      }}
    >
      {QUICK_REACTIONS.map((emoji) => (
        <Pressable
          key={emoji}
          onPress={() => onPick(emoji)}
          style={{
            paddingHorizontal: 4,
            paddingVertical: 2,
            borderRadius: 999,
            backgroundColor:
              selected === emoji
                ? appTheme.reactionSelectedBackgroundColor
                : 'transparent',
            ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
          }}
        >
          <DefaultText style={{ fontSize: 22 }}>{emoji}</DefaultText>
        </Pressable>
      ))}
    </View>
  );
};

const ReactionMenu = ({
  visible,
  showDismissLayer,
  anchor,
  selected,
  onPick,
  onDismiss,
  onHoverChange,
}: {
  visible: boolean,
  showDismissLayer: boolean,
  anchor?: AnchorMeasurement,
  selected: string | undefined,
  onPick: (emoji: string) => void,
  onDismiss: () => void,
  onHoverChange?: (isHovering: boolean) => void,
}) => {
  const windowDimensions = useWindowOverlayDimensions();

  // On web, an `exiting` animation only plays if the `Animated.View` itself
  // is removed while its parent stays mounted; unmounting the whole `Modal`
  // at once makes the bar vanish instantly. So on web, dismissal keeps the
  // overlay mounted for the length of the exit animation and removes just
  // the bar. On native the overlay must not linger — an Android `Modal`
  // blocks all touches while mounted — and Reanimated plays the exit there
  // even when the whole `Modal` unmounts.
  const showModalBar = visible && showDismissLayer;
  const [prevShowModalBar, setPrevShowModalBar] = useState(showModalBar);
  const [isModalBarExiting, setIsModalBarExiting] = useState(false);

  if (showModalBar !== prevShowModalBar) {
    setPrevShowModalBar(showModalBar);
    setIsModalBarExiting(Platform.OS === 'web' && !showModalBar);
  }

  useEffect(() => {
    if (!isModalBarExiting) {
      return;
    }

    const timeout = setTimeout(
      () => setIsModalBarExiting(false),
      REACTION_BAR_ANIMATION_DURATION,
    );

    return () => clearTimeout(timeout);
  }, [isModalBarExiting]);

  if (showModalBar || isModalBarExiting) {
    return (
      <AnchoredOverlay
        visible
        modal
        onRequestClose={onDismiss}
      >
        {showModalBar &&
          <Pressable
            onPressIn={onDismiss}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
            }}
          />
        }
        {showModalBar &&
          <Animated.View
            entering={FadeInDown
              .duration(REACTION_BAR_ANIMATION_DURATION)
              .easing(Easing.inOut(Easing.quad))}
            exiting={FadeOutDown
              .duration(REACTION_BAR_ANIMATION_DURATION)
              .easing(Easing.inOut(Easing.quad))}
            style={aboveAnchorStyle(anchor, windowDimensions, {
              estimatedWidth: REACTION_BAR_ESTIMATED_WIDTH,
              estimatedHeight: REACTION_BAR_ESTIMATED_HEIGHT,
              edgePadding: SCREEN_EDGE_PADDING,
            })}
          >
            <ReactionBar selected={selected} onPick={onPick} />
          </Animated.View>
        }
      </AnchoredOverlay>
    );
  }

  if (!visible) {
    return <></>;
  }

  // The bar normally sits above the message, but when the message is near the
  // top of the window, that would put the bar underneath the `TopNavBar`
  const fitsAbove =
    !anchor ||
    anchor.pageY - REACTION_BAR_ESTIMATED_HEIGHT - SCREEN_EDGE_PADDING >=
      TOP_NAV_ESTIMATED_HEIGHT;

  return (
    <Animated.View
      entering={
        (fitsAbove ? FadeInDown : FadeInUp)
          .duration(REACTION_BAR_ANIMATION_DURATION)
          .easing(Easing.inOut(Easing.quad))
      }
      exiting={
        (fitsAbove ? FadeOutDown : FadeOutUp)
          .duration(REACTION_BAR_ANIMATION_DURATION)
          .easing(Easing.inOut(Easing.quad))
      }
      style={{
        position: 'absolute',
        ...(fitsAbove
          ? { bottom: '100%', paddingBottom: 6 }
          : { top: '100%', paddingTop: 6 }),
        left: 0,
        zIndex: 10,
      }}
      /* @ts-ignore */
      onMouseEnter={
        onHoverChange ? () => onHoverChange(true) : undefined
      }
      onMouseLeave={
        onHoverChange ? () => onHoverChange(false) : undefined
      }
    >
      <ReactionBar selected={selected} onPick={onPick} />
    </Animated.View>
  );
};

const ReactionChip = ({
  emoji,
  onPress,
  style,
}: {
  emoji: string,
  onPress?: () => void,
  style?: StyleProp<ViewStyle>,
}) => {
  const { appTheme } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[
        {
          ...reactionPillChrome(appTheme),
          paddingVertical: 1,
          ...(Platform.OS === 'web' && onPress ? { cursor: 'pointer' } : {}),
        },
        style,
      ]}
    >
      <DefaultText style={{ fontSize: 14 }}>{emoji}</DefaultText>
    </Pressable>
  );
};

export {
  ReactionChip,
  ReactionMenu,
};
