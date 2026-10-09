import {
  RefObject,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import Animated, {
  Easing,
  Keyframe,
  LayoutAnimationConfig,
  LinearTransition,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppTheme } from '../../app-theme/app-theme';
import { isMobile } from '../../util/util';
import {
  closeClubs,
  openClubCard,
  openClubs,
  refreshSuggestedClubs,
  selectSearchClub,
  useClubsSheet,
  useJoinedClubs,
  useSearchClub,
  useSuggestedClubs,
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

const MOVE_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

const moveTransition = LinearTransition
  .duration(MOVE_DURATION)
  .easing(MOVE_EASING);

const popOut = ZoomOut
  .duration(MOVE_DURATION)
  .easing(MOVE_EASING);

const UNDERLAY_OVERLAP = 25;

const TRAY_END_PADDING = 5;

const collapseFrom = (width: number) => new Keyframe({
  0: { width },
  100: { width: UNDERLAY_OVERLAP, easing: MOVE_EASING },
}).duration(MOVE_DURATION);

const ifShown = (onWidth: (width: number) => void) =>
  ({ nativeEvent }: LayoutChangeEvent) => {
    if (nativeEvent.layout.width > 0) {
      onWidth(nativeEvent.layout.width);
    }
  };

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

const NO_CLUBS: string[] = [];

const useRowClubs = () => {
  const yours = useJoinedClubs() ?? NO_CLUBS;
  const { suggested, isReplacing } = useSuggestedClubs();

  const suggestions = useMemo(() => {
    const joined = new Set(yours);
    return (suggested ?? []).map((c) => c.name).filter((c) => !joined.has(c));
  }, [yours, suggested]);

  return { yours, suggestions, isReplacing };
};

const ClubsButton = ({ rowRef }: { rowRef: RefObject<View | null> }) => {
  const { appTheme } = useAppTheme();
  const isSheetOpen = useClubsSheet() !== null;
  const { hovered, hoverProps } = useHover();

  const onPress = () => {
    if (isSheetOpen) {
      return closeClubs();
    }

    rowRef.current?.measureInWindow((x, y, _width, height) =>
      openClubs({ pageX: x + 10, pageY: y + height }));
  };

  return (
    <AnimatedPressable
      onPress={onPress}
      {...hoverProps}
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
          backgroundColor: hovered
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
  );
};

const RibbonChips = memo(({
  yours,
  suggestions,
  isReplacing,
  searchClub,
}: {
  yours: string[],
  suggestions: string[],
  isReplacing: boolean,
  searchClub: string | null,
}) => {
  const { appTheme } = useAppTheme();

  const renderFilter = (name: string | null) =>
    <ClubFilter
      name={name}
      isSelected={name === searchClub}
      onPress={(e) => name !== null && name === searchClub
        ? openClubCard({ name, anchor: e.nativeEvent })
        : selectSearchClub(name)
      }
    />;

  const cells = [
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
  ];

  const [underlayWidths, setUnderlayWidths] =
    useState<Record<string, number>>({});

  const onLayoutUnderlay = (key: string) => ifShown((width) =>
    setUnderlayWidths((widths) =>
      widths[key] === width ? widths : { ...widths, [key]: width }));

  const renderTray = (isUnderlay: boolean) =>
    <View
      aria-hidden={isUnderlay}
      pointerEvents={isUnderlay ? 'none' : 'auto'}
      style={{
        flexDirection: 'row',
        ...(isUnderlay && { position: 'absolute', top: 0, left: 0 }),
      }}
    >
      {cells.map(({ key, node }, i) =>
        <Animated.View
          key={key}
          layout={moveTransition}
          entering={isUnderlay ? undefined : popIn}
          exiting={isUnderlay && yours.length > 1 && underlayWidths[key] !== undefined
            ? collapseFrom(underlayWidths[key])
            : undefined}
          onLayout={isUnderlay ? onLayoutUnderlay(key) : undefined}
          style={{
            height: 50,
            marginLeft: isUnderlay && i > 0 ? -UNDERLAY_OVERLAP : 0,
          }}
        >
          <View
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: i === cells.length - 1 ? -TRAY_END_PADDING : 0,
              backgroundColor: appTheme.inputColor,
              borderTopLeftRadius: i === 0 ? 25 : 0,
              borderBottomLeftRadius: i === 0 ? 25 : 0,
              borderTopRightRadius: i === cells.length - 1 ? 25 : 0,
              borderBottomRightRadius: i === cells.length - 1 ? 25 : 0,
            }}
          />
          <View
            style={{
              flexGrow: 1,
              justifyContent: 'center',
              paddingLeft: i === 0 ? 8 : 3 + (isUnderlay ? UNDERLAY_OVERLAP : 0),
              paddingRight: 3,
              opacity: isUnderlay ? 0 : 1,
            }}
          >
            {node}
          </View>
        </Animated.View>
      )}
    </View>;

  return (
    <LayoutAnimationConfig skipEntering={true}>
      {yours.length > 0 &&
        <Animated.View
          entering={popIn}
          exiting={popOut}
          style={{ marginRight: TRAY_END_PADDING }}
        >
          <LayoutAnimationConfig skipEntering={true}>
            {renderTray(true)}
            {renderTray(false)}
          </LayoutAnimationConfig>
        </Animated.View>
      }
      {suggestions.map((name) =>
        <Animated.View
          key={name}
          layout={moveTransition}
          entering={popIn}
          exiting={isReplacing ? popOut : undefined}
          style={{ zIndex: 1 }}
        >
          <View
            style={{ borderRadius: 999, backgroundColor: appTheme.primaryColor }}
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
          </View>
        </Animated.View>
      )}
    </LayoutAnimationConfig>
  );
});

const ClubRow = () => {
  const { appTheme } = useAppTheme();
  const searchClub = useSearchClub();
  const { yours, suggestions, isReplacing } = useRowClubs();

  const rowRef = useRef<View>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const edgesRef = useRef({ x: 0, viewport: 0, content: 0 });

  const [isAtStart, setIsAtStart] = useState(true);
  const [isAtEnd, setIsAtEnd] = useState(true);
  const [pinned, setPinned] = useState<'none' | 'in' | 'out'>('none');
  const [buttonWidth, setButtonWidth] = useState(0);

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

  const onScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = nativeEvent.contentOffset.x;
    const dx = x - edgesRef.current.x;

    if (x <= 0) {
      setPinned('none');
    } else if (dx < 0) {
      setPinned('in');
    } else if (dx > 0) {
      setPinned('out');
    }

    updateEdges({ x });
  };

  const scrollBy = (dx: number) => () => scrollViewRef.current?.scrollTo({
    x: edgesRef.current.x + dx,
    animated: true,
  });

  return (
    <View
      ref={rowRef}
      style={{
        paddingTop: 4,
        paddingBottom: 5,
        backgroundColor: appTheme.primaryColor,
      }}
    >
      <ScrollView
        ref={scrollViewRef}
        horizontal={true}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={ifShown((viewport) => updateEdges({ viewport }))}
        onContentSizeChange={(width) => width > 0 && updateEdges({ content: width })}
        contentContainerStyle={{
          minHeight: 50,
          alignItems: 'center',
          gap: 6,
          paddingRight: 10,
        }}
      >
        <View
          onLayout={ifShown(setButtonWidth)}
          style={{ paddingLeft: 10 }}
        >
          <ClubsButton rowRef={rowRef} />
        </View>
        <RibbonChips
          yours={yours}
          suggestions={suggestions}
          isReplacing={isReplacing}
          searchClub={searchClub}
        />
      </ScrollView>
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          justifyContent: 'center',
          paddingLeft: 10,
          backgroundColor: appTheme.primaryColor,
          transform: [{ translateX: pinned === 'in' ? 0 : -buttonWidth }],
          transitionProperty: 'transform',
          transitionDuration: pinned === 'none' ? 0 : 200,
        }}
      >
        <ClubsButton rowRef={rowRef} />
      </Animated.View>
      {!isMobile() && !isAtStart &&
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: 40,
            transform: [{ translateX: pinned === 'in' ? buttonWidth : 0 }],
            transitionProperty: 'transform',
            transitionDuration: pinned === 'none' ? 0 : 200,
          }}
        >
          <Continuation side="left" onPress={scrollBy(-SCROLL_JUMP_SIZE)} />
        </Animated.View>
      }
      {!isMobile() && !isAtEnd &&
        <Continuation side="right" onPress={scrollBy(SCROLL_JUMP_SIZE)} />
      }
    </View>
  );
};

export {
  ClubRow,
  moveTransition,
  popIn,
  popOut,
};
