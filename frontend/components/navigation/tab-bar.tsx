import { useState } from 'react';
import {
  Animated,
  View,
} from 'react-native';
import { Pressable } from '../pressable';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { DefaultText } from '../default-text';
import { useInboxStats } from '../../chat/application-layer/hooks/inbox-stats';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LabelToIcon } from './util';
import { useAppTheme } from '../../app-theme/app-theme';
import { useIsWebLoggedOut } from '../../events/signed-in-user';
import { showSignUp } from '../modal/sign-up-modal';
import { PUBLIC_TAB_NAMES } from './public-tabs';

const Tab = ({ navigation, state, route, descriptors, index, numUnread }: {
  navigation: BottomTabBarProps['navigation']
  state: BottomTabBarProps['state']
  route: BottomTabBarProps['state']['routes'][number]
  descriptors: BottomTabBarProps['descriptors']
  index: number
  numUnread: number
}) => {
  const { appThemeName, appTheme } = useAppTheme();
  const isWebLoggedOut = useIsWebLoggedOut();

  const [animated] = useState(() => new Animated.Value(1));

  const backgroundColor = animated.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(0, 0, 0, 1)', 'transparent'],
    extrapolate: 'clamp',
  });

  const fadeOut = () => {
    Animated.timing(animated, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  };

  const fadeIn = () => animated.setValue(appThemeName === 'dark' ? 0 : 0.9);

  const { options } = descriptors[route.key];
  const label =
    typeof options.tabBarLabel === 'string'
      ? options.tabBarLabel
      : options.title !== undefined
      ? options.title
      : route.name;

  const isFocused = state.index === index;

  const onPress = () => {
    // TODO: Do I even need this?
    // navigation.dispatch(StackActions.popToTop());

    if (isWebLoggedOut && !PUBLIC_TAB_NAMES.includes(route.name)) {
      showSignUp(true);
      return;
    }

    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });

    if (!isFocused && !event.defaultPrevented) {
      // The `merge: true` option makes sure that the params inside the tab screen are preserved
      navigation.navigate({ name: route.name, params: undefined, merge: true });
    }
  };

  return (
    <Pressable
      key={route.key}
      onPress={onPress}
      onPressIn={fadeIn}
      onPressOut={fadeOut}
      style={{
        flex: 1,
        height: '100%',
      }}
    >
      <Animated.View
        accessibilityRole="button"
        accessibilityState={isFocused ? { selected: true } : {}}
        accessibilityLabel={options.tabBarAccessibilityLabel}
        testID={options.tabBarButtonTestID}
        style={{
          width: '100%',
          height: '100%',
          paddingTop: 6,
          paddingBottom: 6,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: backgroundColor,
          flexDirection: 'column',
          overflow: 'visible',
        }}
      >
        <LabelToIcon
          label={label}
          isFocused={isFocused}
          numUnread={numUnread}
          color={appTheme.secondaryColor}
          backgroundColor={appTheme.primaryColor}
          indicatorColor={appTheme.primaryColor}
          indicatorBackgroundColor={appTheme.brandColor}
          indicatorBorderColor={appTheme.primaryColor}
        />
        <DefaultText
          style={{
            textAlign: 'center',
            fontFamily: isFocused ? 'MontserratBold' : 'MontserratRegular',
            fontSize: 12,
          }}
        >
          {label}
        </DefaultText>
      </Animated.View>
    </Pressable>
  );
};

const TabBar = ({state, descriptors, navigation}: {
  state: BottomTabBarProps['state']
  descriptors: BottomTabBarProps['descriptors']
  navigation: BottomTabBarProps['navigation']
}) => {
  const insets = useSafeAreaInsets();

  const stats = useInboxStats();
  const numUnread =
    (stats?.numUnreadChats ?? 0) +
    (stats?.numUnreadIntros ?? 0);

  return (
    <View
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        height: 50 + insets.bottom,
        paddingBottom: insets.bottom,
        width: '100%',
        overflow: 'visible',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          height: '100%',
          width: '100%',
          maxWidth: 600,
          overflow: 'visible',
        }}
      >
        {state.routes.map((route, index) =>
          <Tab
            key={index}
            navigation={navigation}
            state={state}
            route={route}
            descriptors={descriptors}
            index={index}
            numUnread={numUnread}
          />
        )}
      </View>
    </View>
  );
};

export {
  TabBar,
};
