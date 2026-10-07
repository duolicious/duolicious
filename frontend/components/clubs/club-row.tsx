import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import Animated, {
  Easing,
  LayoutAnimationConfig,
  LinearTransition,
  ZoomIn,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useDerivedEvent } from '../../events/events';
import { useAppTheme } from '../../app-theme/app-theme';
import { isMobile } from '../../util/util';
import {
  ClubItem,
  closeClubs,
  openClubCard,
  openClubs,
  refreshSuggestedClubs,
  selectSearchClub,
  useClubsSheet,
  useJoinedClubs,
  useSearchClub,
} from '../../club/club';
import { Club, ClubFilter } from '../club';
import { DefaultText } from '../default-text';
import {
  AnimatedPressable,
  HoverCircle,
  hoverTransition,
  useHover,
} from '../hover';

const SCROLL_JUMP_SIZE = 150;
const MOVE_DURATION = 450;

const popIn = ZoomIn
  .duration(MOVE_DURATION)
  .easing(Easing.bezier(0.34, 1.56, 0.64, 1));

const moveTransition = LinearTransition
  .duration(MOVE_DURATION)
  .easing(Easing.bezier(0.2, 0.8, 0.2, 1));

const Continuation = ({
  side,
  onPress,
}: {
  side: 'left' | 'right',
  onPress: () => void,
}) => {
  const { appTheme } = useAppTheme();
  const { hovered, hoverProps } = useHover();

  const colors: [string, string, string] = side === 'left'
    ? [`${appTheme.primaryColor}ff`, `${appTheme.primaryColor}e5`, `${appTheme.primaryColor}00`]
    : [`${appTheme.primaryColor}00`, `${appTheme.primaryColor}e5`, `${appTheme.primaryColor}ff`];

  return (
    <Pressable
      onPress={onPress}
      {...hoverProps}
      style={{
        position: 'absolute',
        top: 0,
        [side]: 0,
        height: '100%',
        width: 40,
        zIndex: 999,
      }}
    >
      <LinearGradient
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        locations={side === 'left' ? [0.0, 0.8, 1.0] : [0.0, 0.2, 1.0]}
        colors={colors}
        style={{
          height: '100%',
          width: '100%',
          justifyContent: 'center',
          alignItems: side === 'left' ? 'flex-start' : 'flex-end',
        }}
      >
        <View
          style={{
            width: 30,
            height: 30,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <HoverCircle visible={hovered} inset={0} />
          <Ionicons
            style={{ fontSize: 26, color: appTheme.secondaryColor }}
            name={side === 'left' ? 'chevron-back' : 'chevron-forward'}
          />
        </View>
      </LinearGradient>
    </Pressable>
  );
};

const useRowClubs = () => {
  const yours = useJoinedClubs() ?? [];
  const suggested = useDerivedEvent<ClubItem[] | undefined, ClubItem[]>(
    'suggested-clubs', (cs) => cs ?? [], []);

  const joined = new Set(yours);

  return {
    yours,
    suggestions: suggested
      .map((c) => c.name)
      .filter((c) => !joined.has(c)),
  };
};

const ClubRow = () => {
  const { appTheme } = useAppTheme();
  const searchClub = useSearchClub();
  const isSheetOpen = useClubsSheet() !== null;
  const { yours, suggestions } = useRowClubs();
  const { hovered: isClubsHovered, hoverProps: clubsHoverProps } = useHover();

  const rowRef = useRef<View>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const edgesRef = useRef({ x: 0, viewport: 0, content: 0 });

  const [isAtStart, setIsAtStart] = useState(true);
  const [isAtEnd, setIsAtEnd] = useState(true);

  useEffect(() => {
    refreshSuggestedClubs();
  }, []);

  useEffect(() => {
    scrollViewRef.current?.scrollTo({ x: 0, animated: true });
  }, [yours[0]]);

  const updateEdges = (edges: Partial<typeof edgesRef.current>) => {
    const { x, viewport, content } = Object.assign(edgesRef.current, edges);
    setIsAtStart(x <= 10);
    setIsAtEnd(x + viewport >= content - 10);
  };

  const scrollBy = (dx: number) => () => scrollViewRef.current?.scrollTo({
    x: edgesRef.current.x + dx,
    animated: true,
  });

  const onPressClubs = () => {
    if (isSheetOpen) {
      return closeClubs();
    }

    rowRef.current?.measureInWindow((x, y, _width, height) =>
      openClubs({ pageX: x + 10, pageY: y + height }));
  };

  const renderFilter = (name: string | null) =>
    <ClubFilter
      name={name}
      isSelected={name === searchClub}
      onPress={(e) => name !== null && name === searchClub
        ? openClubCard({ name, anchor: e.nativeEvent })
        : selectSearchClub(name)
      }
    />;

  return (
    <View
      ref={rowRef}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingTop: 4,
        paddingBottom: 5,
        paddingLeft: 10,
        backgroundColor: appTheme.primaryColor,
      }}
    >
      <AnimatedPressable
        onPress={onPressClubs}
        {...clubsHoverProps}
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            height: 34,
            marginLeft: -6,
            paddingLeft: 8,
            paddingRight: 8,
            borderRadius: 999,
            backgroundColor: isClubsHovered
              ? appTheme.hoverOverlayColor
              : 'transparent',
          },
          hoverTransition(['backgroundColor']),
        ]}
      >
        <DefaultText style={{ fontSize: 15, fontWeight: '800' }}>
          Clubs
        </DefaultText>
        <Animated.View
          style={{
            transform: [{ rotate: isSheetOpen ? '180deg' : '0deg' }],
            transitionProperty: 'transform',
            transitionDuration: 250,
          }}
        >
          <Ionicons
            name="chevron-down"
            style={{ fontSize: 14, color: appTheme.secondaryColor }}
          />
        </Animated.View>
      </AnimatedPressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <ScrollView
          ref={scrollViewRef}
          horizontal={true}
          showsHorizontalScrollIndicator={false}
          onScroll={({ nativeEvent }) =>
            updateEdges({ x: nativeEvent.contentOffset.x })}
          scrollEventThrottle={50}
          onLayout={({ nativeEvent }) =>
            updateEdges({ viewport: nativeEvent.layout.width })}
          onContentSizeChange={(width) => updateEdges({ content: width })}
          contentContainerStyle={{
            alignItems: 'center',
            gap: 6,
            paddingRight: 10,
          }}
        >
          <LayoutAnimationConfig skipEntering={true}>
            <View style={{ flexDirection: 'row' }}>
              {[
                { key: '', node: renderFilter(null) },
                {
                  key: 'divider',
                  node: <View
                    style={{
                      width: 1,
                      height: 24,
                      backgroundColor: appTheme.reactionBarBorderColor,
                    }}
                  />,
                },
                ...yours.map((name) => ({ key: name, node: renderFilter(name) })),
              ].map(({ key, node }, i, cells) =>
                <Animated.View
                  key={key}
                  layout={moveTransition}
                  entering={popIn}
                  style={{
                    justifyContent: 'center',
                    height: 50,
                    paddingLeft: i === 0 ? 8 : 3,
                    paddingRight: i === cells.length - 1 ? 8 : 3,
                    backgroundColor: appTheme.inputColor,
                    borderTopLeftRadius: i === 0 ? 25 : 0,
                    borderBottomLeftRadius: i === 0 ? 25 : 0,
                    borderTopRightRadius: i === cells.length - 1 ? 25 : 0,
                    borderBottomRightRadius: i === cells.length - 1 ? 25 : 0,
                  }}
                >
                  {node}
                </Animated.View>
              )}
            </View>
            {suggestions.map((name) =>
              <Animated.View
                key={name}
                layout={moveTransition}
                entering={popIn}
              >
                <Club
                  name={name}
                  isMutual={false}
                  onPress={(e) => openClubCard({
                    name,
                    anchor: e.nativeEvent,
                    rowPosition: 'end',
                  })}
                />
              </Animated.View>
            )}
          </LayoutAnimationConfig>
        </ScrollView>
        {!isMobile() && !isAtStart &&
          <Continuation side="left" onPress={scrollBy(-SCROLL_JUMP_SIZE)} />
        }
        {!isMobile() && !isAtEnd &&
          <Continuation side="right" onPress={scrollBy(SCROLL_JUMP_SIZE)} />
        }
      </View>
    </View>
  );
};

export {
  ClubRow,
};
