import { useState } from 'react';
import {
  Text,
  View,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable } from '../pressable';
import { DefaultText } from '../default-text';
import { CommonActions } from '@react-navigation/native';
import type { WebBarProps } from './web-navigator';
import { Logo16 } from '../logo';
import { LabelToIcon } from './util';
import { useInboxStats } from '../../chat/application-layer/hooks/inbox-stats';
import { WebBarFooter } from './web-bar-footer/web-bar-footer';
import { useAppTheme } from '../../app-theme/app-theme';
import { useIsWebLoggedOut } from '../../events/signed-in-user';
import { hasDesktopJoinCard, showSignUp } from '../modal/sign-up-modal';
import { JoinCard } from './join-card';
import { PUBLIC_TAB_NAMES } from './public-tabs';

const Logo = () => {
  return (
    <View
      style={{
        flexDirection: 'row',
        padding: 16,
        gap: 6,
      }}
    >
      <View
        style={{
          width: 60,
          alignItems: 'center',
        }}
      >
        <Logo16/>
      </View>
      <Text
        style={{
          color: 'white',
          alignSelf: 'center',
          fontFamily: 'TruenoBold',
          fontSize: 22,
          textAlign: 'center',
        }}
        selectable={false}
      >
        Duolicious
      </Text>
    </View>
  );
};

type NavigationProps = Pick<WebBarProps, 'state' | 'navigation' | 'descriptors'>;

const NavigationItems = ({state, navigation, descriptors, routes = state.routes}:
  NavigationProps & { routes?: WebBarProps['state']['routes'] }
) => {
  const { appThemeName } = useAppTheme();
  const isWebLoggedOut = useIsWebLoggedOut();

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const stats = useInboxStats();
  const numUnread =
    (stats?.numUnreadChats ?? 0) +
    (stats?.numUnreadIntros ?? 0);

  return (
    <View
      style={{
        flex: 1,
      }}
    >
      {routes.map((route) => {
        const { options } = descriptors[route.key];
        const label =
          options.title !== undefined
            ? options.title
            : route.name;

        const isFocused = state.routes[state.index].key === route.key;

        const iconBackgroundColor = (() => {
          if (appThemeName === 'dark') {
            return isFocused ?  '#ffffff' : '#000000';
          } else {
            return isFocused ?  '#ffffff' : '#7700ff';
          }
        })();

        const backgroundColor = (() => {
          if (isFocused) {
            return '#ffffff';
          }
          if (hoveredKey === route.key) {
            return '#ffffff4d';
          }

          return appThemeName === 'dark' ? '#000000' : '#7700ff';
        })();

        return (
          <Pressable
            key={route.key}
            onPress={() => {
              if (isWebLoggedOut && !PUBLIC_TAB_NAMES.includes(route.name)) {
                showSignUp(true);
                return;
              }

              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
                data: {
                  isAlreadyFocused: isFocused,
                },
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.dispatch({
                  ...CommonActions.navigate(route),
                  target: state.key,
                });
              }
            }}
            onHoverIn={() => {
              if (isFocused) return;
              setHoveredKey(route.key);
            }}
            onHoverOut={() => {
              if (isFocused) return;
              setHoveredKey(current => (current === route.key ? null : current));
            }}
            style={{
              padding: 12,
              margin: 4,
              flexDirection: 'row',
              gap: 6,
              borderRadius: 999,
              position: 'relative',
              backgroundColor: backgroundColor
            }}
          >
            <View
              style={{
                width: 60,
                alignItems: 'center',
              }}
            >
              <LabelToIcon
                label={label}
                isFocused={isFocused}
                numUnread={numUnread}
                color={isFocused ? "black" : "white"}
                backgroundColor={iconBackgroundColor}
                indicatorColor={iconBackgroundColor}
                indicatorBackgroundColor={isFocused ? "black" : 'white'}
                indicatorBorderColor={iconBackgroundColor}
                fontSize={26}
              />
            </View>
            <DefaultText
              style={{
                color: isFocused ? 'black' : 'white',
                fontWeight: isFocused ? 900 : 700,
                fontSize: 20,
              }}
            >
              {descriptors[route.key].options.title || route.name}
            </DefaultText>
          </Pressable>
        );
      })}
    </View>
  );
};

const FADE_HEIGHT = 64;

const railColor = (appThemeName: string): string =>
  appThemeName === 'dark' ? '#000000' : '#7700ff';

const RailWithJoinCard = ({state, navigation, descriptors}: NavigationProps) => {
  const { appThemeName } = useAppTheme();
  const { height: windowHeight } = useWindowDimensions();
  const [topHeight, setTopHeight] = useState(0);
  const [bottomHeight, setBottomHeight] = useState(0);

  const color = railColor(appThemeName);

  return (
    <View style={{ flexGrow: 1, width: 260 }}>
      <View
        style={{ gap: 20 }}
        onLayout={(e) => setTopHeight(e.nativeEvent.layout.height)}
      >
        <Logo/>
        <NavigationItems
          state={state}
          navigation={navigation}
          descriptors={descriptors}
          routes={state.routes.filter((r) => PUBLIC_TAB_NAMES.includes(r.name))}
        />
      </View>
      <View style={{ flexGrow: 1, flexBasis: 0, overflow: 'hidden' }}>
        <NavigationItems
          state={state}
          navigation={navigation}
          descriptors={descriptors}
          routes={state.routes.filter((r) => !PUBLIC_TAB_NAMES.includes(r.name))}
        />
        <LinearGradient
          colors={[`${color}00`, color]}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: FADE_HEIGHT,
          }}
        />
      </View>
      <View
        style={{ gap: 20, paddingBottom: 10, alignItems: 'center' }}
        onLayout={(e) => {
          const { height } = e.nativeEvent.layout;
          setBottomHeight((h) => Math.max(h, height));
        }}
      >
        <JoinCard/>
        <WebBarFooter
          socialAsLinks={true}
          showStoreBadges={windowHeight >= topHeight + bottomHeight}
        />
      </View>
    </View>
  );
};

const WebBar = ({state, navigation, tabBarStyle, descriptors}: WebBarProps) => {
  const { appThemeName } = useAppTheme();
  const isWebLoggedOut = useIsWebLoggedOut();
  const hasJoinCard = isWebLoggedOut && hasDesktopJoinCard();

  return (
    <ScrollView
      style={{
        height: '100%',
        backgroundColor: railColor(appThemeName),
        borderRightWidth: 5,
        borderColor: 'black',
      }}
      contentContainerStyle={[
        {
          width: '100%',
          alignItems: 'flex-end',
          paddingHorizontal: 12,
        },
        hasJoinCard ? { flexGrow: 1 } : { flex: 1 },
        tabBarStyle,
      ]}
      showsVerticalScrollIndicator={false}
    >
      {hasJoinCard &&
        <RailWithJoinCard
          state={state}
          navigation={navigation}
          descriptors={descriptors}
        />
      }
      {!hasJoinCard &&
        <View
          style={{
            flex: 1,
            justifyContent: 'space-between',
            width: 260,
          }}
        >
          <View
            style={{
              width: '100%',
              gap: 20,
            }}
          >
            <Logo/>
            <NavigationItems
              state={state}
              navigation={navigation}
              descriptors={descriptors}
            />
          </View>
          <View
            style={{
              width: '100%',
              paddingTop: 40,
              paddingBottom: 10,
              alignItems: 'center',
            }}
          >
            <WebBarFooter/>
          </View>
        </View>
      }
    </ScrollView>
  );
};

export {
  WebBar,
}
