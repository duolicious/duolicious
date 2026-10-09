import { memo, useDeferredValue, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextStyle,
  View,
} from 'react-native';
import Animated, {
  LayoutAnimationConfig,
  useAnimatedStyle,
  withTiming,
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
import { moveTransition, popIn, popOut } from './club-row';

const MAX_COLLAPSED_CLUBS = 6;

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
        return openClubCard({ name, anchor: e.nativeEvent });
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
      onPress={(e) => openClubCard({ name, anchor: e.nativeEvent })}
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

  const trayStyle = useAnimatedStyle(() => ({
    opacity: withTiming(isManaging ? 0 : 1, { duration: 250 }),
  }), [isManaging]);

  const joined = new Set(clubs);

  const mine = q
    ? clubs.filter((c) => c.toLowerCase().includes(q))
    : isAllOpen ? clubs : clubs.slice(0, MAX_COLLAPSED_CLUBS);

  const others = (q ? (results?.q === q ? results.clubs : null) : suggested)
    ?.filter((c) => !joined.has(c.name));


  const linkTextStyle: TextStyle = {
    fontSize: 13,
    fontWeight: '700',
    color: appTheme.brandColor,
  };

  return (
    <View style={{ flexShrink: 1 }}>
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
            }}
          />
        </View>
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
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: 6,
                padding: 8,
                marginHorizontal: -8,
              }}
            >
              <Animated.View
                style={[
                  StyleSheet.absoluteFill,
                  { borderRadius: 16, backgroundColor: appTheme.inputColor },
                  trayStyle,
                ]}
              />
              {mine.map((c) =>
                <MineFilter
                  key={c}
                  name={c}
                  isSelected={!isManaging && c === searchClub}
                  isManaging={isManaging}
                />
              )}
            </View>
            {!q && clubs.length > MAX_COLLAPSED_CLUBS &&
              <Pressable
                onPress={() => setIsAllOpen(!isAllOpen)}
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
                  {isAllOpen ? 'Show fewer' : `See all ${clubs.length}`}
                </DefaultText>
                <Ionicons
                  name={isAllOpen ? 'chevron-up' : 'chevron-down'}
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
    </View>
  );
};

export {
  ClubsPanel,
};
