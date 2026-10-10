import { memo, useDeferredValue, useEffect, useState } from 'react';
import {
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextStyle,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  LayoutAnimationConfig,
} from 'react-native-reanimated';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAppTheme } from '../../app-theme/app-theme';
import {
  ClubItem,
  closeClubs,
  fetchClubItems,
  moveClubToFront,
  openClubCard,
  selectSearchClub,
  sortClubs,
  useJoinedClubs,
  useSearchClub,
  useSuggestedClubs,
} from '../../club/club';
import { Club, ClubFilter } from '../club';
import { DefaultText } from '../default-text';
import { DefaultTextInput } from '../default-text-input';
import { LogoActivityIndicator } from '../logo/logo-activity-indicator';
import { useIsScrolled } from './use-is-scrolled';
import { isMobile } from '../../util/util';
import { moveTransition, popIn, popOut } from './club-row';

const MAX_COLLAPSED_CLUBS = 6;

const TRAY_RESIZE_MS = 250;

const trayStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 6,
  padding: 8,
} as const;

const MineFilter = memo(({
  name,
  isSelected,
  isManaging,
}: {
  name: string,
  isSelected: boolean,
  isManaging: boolean,
}) =>
  <ClubFilter
    name={name}
    isSelected={isSelected}
    onPress={(e) => {
      if (isManaging || isSelected) {
        return openClubCard({ name, anchor: e });
      }

      selectSearchClub(name);
      moveClubToFront(name);
      closeClubs();
    }}
  />
);

const OtherClub = memo(({
  name,
  isAnimated,
  isLeaving,
}: {
  name: string,
  position: number,
  isAnimated: boolean,
  isLeaving: boolean,
}) =>
  <Animated.View
    layout={isAnimated ? moveTransition : undefined}
    entering={isAnimated ? popIn : undefined}
    exiting={isAnimated && isLeaving ? popOut : undefined}
  >
    <Club
      name={name}
      isMutual={false}
      onPress={(e) => openClubCard({ name, anchor: e })}
    />
  </Animated.View>
);

const ClubsPanel = () => {
  const { appTheme } = useAppTheme();
  const searchClub = useSearchClub();
  const clubs = sortClubs(useJoinedClubs() ?? []);
  const { suggested, leaving } = useSuggestedClubs();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ q: string, clubs: ClubItem[] }>();
  const [isManaging, setIsManaging] = useState(false);
  const [isAllOpen, setIsAllOpen] = useState(false);
  const [trayHeight, setTrayHeight] = useState<number>();
  const [collapsedHeight, setCollapsedHeight] = useState<number>();
  const [isCollapsing, setIsCollapsing] = useState(false);

  const onTrayLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    if (nativeEvent.layout.height > 0) {
      setTrayHeight(nativeEvent.layout.height);
    }
  };

  useEffect(() => {
    if (!isCollapsing) {
      return;
    }
    const timer = setTimeout(() => {
      setIsAllOpen(false);
      setIsCollapsing(false);
    }, TRAY_RESIZE_MS);
    return () => clearTimeout(timer);
  }, [isCollapsing]);

  const toggleAll = () =>
    isAllOpen ? setIsCollapsing(!isCollapsing) : setIsAllOpen(true);

  const isShowingAll = isAllOpen && !isCollapsing;
  const { isScrolled, onScroll } = useIsScrolled();
  const isReady = useDeferredValue(true, false);

  const q = query.trim().toLowerCase();

  useEffect(() => {
    if (!q) {
      return;
    }

    const timer = setTimeout(
      async () => setResults({ q, clubs: await fetchClubItems(q) }), 500);

    return () => clearTimeout(timer);
  }, [q]);

  const joined = new Set(clubs);

  const mine = q
    ? clubs.filter((c) => c.toLowerCase().includes(q))
    : isAllOpen ? clubs : clubs.slice(0, MAX_COLLAPSED_CLUBS);

  const others = (q ? (results?.q === q ? results.clubs : null) : suggested)
    ?.filter((c) => !joined.has(c.name));


  const isSearchAtBottom = Platform.OS === 'web' && isMobile();

  const linkTextStyle: TextStyle = {
    fontSize: 13,
    fontWeight: '700',
    color: appTheme.brandColor,
  };

  const searchBox = (
    <View style={{ justifyContent: 'center' }}>
      <Ionicons
        name="search"
        style={{
          position: 'absolute',
          left: 14,
          fontSize: 18,
          color: appTheme.hintColor,
          zIndex: 1,
        }}
      />
      <DefaultTextInput
        placeholder="Find clubs"
        value={query}
        onChangeText={setQuery}
        style={{
          marginLeft: 0,
          marginRight: 0,
          height: 44,
          paddingLeft: 42,
          paddingRight: 40,
        }}
      />
      {query !== '' &&
        <Pressable
          aria-label="Clear search"
          onPress={() => setQuery('')}
          style={{
            position: 'absolute',
            right: 4,
            top: 4,
            width: 36,
            height: 36,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            name="close"
            style={{ fontSize: 20, color: appTheme.secondaryColor }}
          />
        </Pressable>
      }
    </View>
  );

  return (
    <View style={{ flexGrow: isSearchAtBottom ? 1 : 0, flexShrink: 1 }}>
      <View
        style={{
          paddingHorizontal: 20,
          paddingBottom: 10,
          gap: 10,
          borderBottomWidth: 1,
          borderBottomColor: isScrolled ? appTheme.inputColor : 'transparent',
        }}
      >
        <DefaultText style={{ fontSize: 20, fontWeight: '700' }}>
          Clubs
        </DefaultText>
        {!isSearchAtBottom && searchBox}
      </View>
      {isReady && <ScrollView
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={{ flexShrink: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
      >
        {mine.length > 0 &&
          <>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginTop: 6,
                marginBottom: 8,
                marginHorizontal: 2,
              }}
            >
              <DefaultText style={{ fontSize: 13, fontWeight: '700' }}>
                {isManaging ? 'Your clubs' : 'Filter search by your clubs'}
              </DefaultText>
              <Pressable onPress={() => setIsManaging(!isManaging)} hitSlop={10}>
                <DefaultText style={linkTextStyle}>
                  {isManaging ? 'Filter' : 'Manage'}
                </DefaultText>
              </Pressable>
            </View>
            <Animated.View
              style={{
                height: isCollapsing ? collapsedHeight : trayHeight,
                marginHorizontal: -8,
                borderRadius: 25,
                overflow: 'hidden',
                transitionProperty: 'height',
                transitionDuration: TRAY_RESIZE_MS,
                transitionTimingFunction: 'ease-out',
              }}
            >
              <Animated.View
                style={[StyleSheet.absoluteFill, {
                  backgroundColor: appTheme.inputColor,
                  opacity: isManaging ? 0 : 1,
                  transitionProperty: 'opacity',
                  transitionDuration: 250,
                  transitionTimingFunction: 'ease-in-out',
                }]}
              />
              {isAllOpen &&
                <View
                  aria-hidden={true}
                  pointerEvents="none"
                  onLayout={({ nativeEvent }) => nativeEvent.layout.height > 0 &&
                    setCollapsedHeight(nativeEvent.layout.height)}
                  style={[trayStyle, {
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    opacity: 0,
                  }]}
                >
                  {clubs.slice(0, MAX_COLLAPSED_CLUBS).map((c) =>
                    <ClubFilter key={c} name={c} isSelected={false} onPress={() => {}} />
                  )}
                </View>
              }
              <LayoutAnimationConfig skipEntering={true}>
                <View
                  onLayout={onTrayLayout}
                  style={trayStyle}
                >
                  {mine.map((c) =>
                    <Animated.View
                      key={c}
                      entering={FadeIn.duration(TRAY_RESIZE_MS)}
                    >
                      <MineFilter
                        name={c}
                        isSelected={!isManaging && c === searchClub}
                        isManaging={isManaging}
                      />
                    </Animated.View>
                  )}
                </View>
              </LayoutAnimationConfig>
            </Animated.View>
            {!q && clubs.length > MAX_COLLAPSED_CLUBS &&
              <Pressable
                onPress={toggleAll}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  marginTop: 10,
                  marginHorizontal: 2,
                  alignSelf: 'flex-start',
                }}
              >
                <DefaultText style={linkTextStyle}>
                  {isShowingAll ? 'Show fewer' : `See all ${clubs.length}`}
                </DefaultText>
                <Ionicons
                  name={isShowingAll ? 'chevron-up' : 'chevron-down'}
                  style={{ fontSize: 13, color: appTheme.brandColor }}
                />
              </Pressable>
            }
          </>
        }
        <DefaultText
          style={{
            fontSize: 13,
            fontWeight: '700',
            marginTop: 18,
            marginBottom: 8,
            marginHorizontal: 2,
          }}
        >
          Explore other clubs
        </DefaultText>
        {others
          ? <LayoutAnimationConfig skipEntering={true}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {others.map((c, i) =>
                  <OtherClub
                    key={c.name}
                    name={c.name}
                    position={i}
                    isAnimated={!q}
                    isLeaving={leaving.has(c.name)}
                  />
                )}
              </View>
            </LayoutAnimationConfig>
          : <View style={{ paddingVertical: 30, alignItems: 'center' }}>
              <LogoActivityIndicator size="large" color={appTheme.brandColor} />
            </View>
        }
      </ScrollView>}
      {isSearchAtBottom &&
        <View
          style={{
            marginTop: 'auto',
            paddingHorizontal: 20,
            paddingVertical: 10,
            borderTopWidth: 1,
            borderTopColor: appTheme.inputColor,
          }}
        >
          {searchBox}
        </View>
      }
    </View>
  );
};

export {
  ClubsPanel,
};
