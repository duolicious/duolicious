import { useEffect } from 'react';
import {
  Platform,
  Pressable,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Polygon, Polyline } from 'react-native-svg';
import { safeBestTextOn } from '../../util/util';

// The floating, bobbing speech bubble shared by the app's one-time hints
// (`AboutReplyHint`, `InboxFilterHint`). Purely presentational: each hint owns
// its visibility (seen-flag, focus handling) and anchors the bubble by
// rendering it inside a positioned parent, passing offsets via `style`. The
// pointer points up at the anchor from the corner `pointerPosition` names.
//
// `children` receives the ink colour that contrasts with the bubble, for
// styling the hint's icon and text.
const HintBubble = ({
  color,
  pointerPosition,
  style,
  onPress,
  children,
}: {
  color: string,
  pointerPosition: 'left' | 'right',
  style?: ViewStyle,
  onPress: () => void,
  children: (inkColor: string) => React.ReactNode,
}) => {
  // Gently bob the hint up and down so it reads as a floating call-to-action,
  // distinct from the static content around it. The bob lives on its own
  // inner view so its transform doesn't fight the enter/exit layout
  // animations applied to the outer view.
  const bob = useSharedValue(0);

  useEffect(() => {
    bob.value = withRepeat(
      withSequence(
        withTiming(-5, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: 1000, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, []);

  const bobStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bob.value }],
  }));

  const inkColor = safeBestTextOn(color, '#ffffff');

  return (
    <Animated.View
      pointerEvents="box-none"
      entering={FadeIn}
      exiting={FadeOut}
      style={{
        position: 'absolute',
        top: '100%',
        marginTop: 10,
        zIndex: 10,
        elevation: 10,
        ...style,
      }}
    >
      <Animated.View
        style={[
          {
            alignItems:
              pointerPosition === 'left' ? 'flex-start' : 'flex-end',
          },
          bobStyle,
        ]}
      >
      {/*
        The pointer is a single SVG shape rather than two stacked CSS-border
        triangles. Stacked triangles leave an internal horizontal seam between
        the border-colored and fill-colored layers that shimmers at fractional
        `bob` positions. Here the fill is one polygon and only the two slanted
        edges are stroked (the base is left open), so there's no internal seam
        and nothing horizontal to shimmer. It's lifted above the bubble and its
        base overlaps the bubble's top edge so the fill covers the bubble's top
        border line where they join.
      */}
      <View
        style={{
          ...(pointerPosition === 'left'
            ? { marginLeft: 8 }
            : { marginRight: 8 }),
          marginBottom: -3,
          zIndex: 2,
        }}
      >
        <Svg width={18} height={11}>
          {/*
            The fill extends all the way down to the base (y=10) so it buries
            the bubble's 1px top border and never shimmers. The stroked edges,
            however, stop 1px short (y=9) so the angled outline lines up with
            the top of the bubble's borders instead of overshooting downward.
          */}
          <Polygon points="9,1 1,10 17,10" fill={color} />
          <Polyline
            points="1.9,9 9,1 16.1,9"
            fill="none"
            stroke={inkColor}
            strokeWidth={1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </View>
      <Pressable
        onPress={onPress}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: color,
          borderWidth: 1,
          borderColor: inkColor,
          paddingVertical: 9,
          paddingHorizontal: 12,
          borderRadius: 8,
          zIndex: 1,
          ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
        }}
      >
        {children(inkColor)}
      </Pressable>
      </Animated.View>
    </Animated.View>
  );
};

export {
  HintBubble,
};
