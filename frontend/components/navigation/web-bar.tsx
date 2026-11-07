import { useState } from 'react';
import {
  Text,
  View,
  ScrollView,
} from 'react-native';
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
import { showSignUp } from '../modal/sign-up-modal';
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

const NavigationItems = ({state, navigation, descriptors}:
  Pick<WebBarProps, 'state' | 'navigation' | 'descriptors'>
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
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key];
        const label =
          options.title !== undefined
            ? options.title
            : route.name;

        const isFocused = state.index === index;

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

              const isFocused = state.index === index;
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

const WebBar = ({state, navigation, tabBarStyle, descriptors}: WebBarProps) => {
  const { appThemeName } = useAppTheme();

  return (
    <ScrollView
      style={{
        height: '100%',
        backgroundColor: appThemeName === 'dark' ? 'black' : '#70f',
        borderRightWidth: 5,
        borderColor: 'black',
      }}
      contentContainerStyle={[
        {
          width: '100%',
          flex: 1,
          alignItems: 'flex-end',
          paddingHorizontal: 12,
        },
        tabBarStyle,
      ]}
      showsVerticalScrollIndicator={false}
    >
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
    </ScrollView>
  );
};

export {
  WebBar,
}
