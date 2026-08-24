import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { useState } from 'react';
import {
  createNavigatorFactory,
  type DefaultNavigatorOptions,
  type ParamListBase,
  type TabActionHelpers,
  type TabNavigationState,
  TabRouter,
  type TabRouterOptions,
  useNavigationBuilder,
} from '@react-navigation/native';
import {
  CONTENT_COLUMN_STYLE,
  LEFT_PANE_STYLE,
  RIGHT_PANE_STYLE,
  hasRightPane,
} from './web-layout';
import { WebBar } from './web-bar';
import { Scrollbar } from './scroll-bar';
import { RightPanel } from './right-panel';

// Props accepted by the view
type TabNavigationConfig = {
  tabBarStyle: StyleProp<ViewStyle>;
  contentStyle: StyleProp<ViewStyle>;
};

// Supported screen options
type TabNavigationOptions = {
  title?: string;
};

// Map of event name and the type of data (in event.data)
//
// canPreventDefault: true adds the defaultPrevented property to the
// emitted events.
type TabNavigationEventMap = {
  tabPress: {
    data: { isAlreadyFocused: boolean };
    canPreventDefault: true;
  };
};

type WebNavigatorBuilder = ReturnType<
  typeof useNavigationBuilder<
    TabNavigationState<ParamListBase>,
    TabRouterOptions,
    TabActionHelpers<ParamListBase>,
    TabNavigationOptions,
    TabNavigationEventMap
  >
>;

type WebBarProps = {
  state: WebNavigatorBuilder['state'];
  navigation: WebNavigatorBuilder['navigation'];
  descriptors: WebNavigatorBuilder['descriptors'];
  tabBarStyle: StyleProp<ViewStyle>;
};

// The props accepted by the component is a combination of 3 things
type Props<Navigation> = DefaultNavigatorOptions<
  ParamListBase,
  string | undefined,
  TabNavigationState<ParamListBase>,
  TabNavigationOptions,
  TabNavigationEventMap,
  Navigation
> &
  TabRouterOptions &
  TabNavigationConfig;

function WebNavigator<Navigation>({
  id,
  initialRouteName,
  children,
  layout,
  screenListeners,
  screenOptions,
  screenLayout,
  backBehavior,
  tabBarStyle,
}: Props<Navigation>) {
  const { state, navigation, descriptors, NavigationContent } =
    useNavigationBuilder<
      TabNavigationState<ParamListBase>,
      TabRouterOptions,
      TabActionHelpers<ParamListBase>,
      TabNavigationOptions,
      TabNavigationEventMap
    >(TabRouter, {
      id,
      initialRouteName,
      children,
      layout,
      screenListeners,
      screenOptions,
      screenLayout,
      backBehavior,
    });

  const { width: windowWidth } = useWindowDimensions();

  const focusedRouteKey = state.routes[state.index].key;

  const [loadedRouteKeys, setLoadedRouteKeys] = useState([focusedRouteKey]);

  if (!loadedRouteKeys.includes(focusedRouteKey)) {
    setLoadedRouteKeys([...loadedRouteKeys, focusedRouteKey]);
  }

  return (
    <NavigationContent>
      <View
        style={{
          flexDirection: 'row',
          flex: 1,
          justifyContent: 'center',
        }}
      >
        <View style={[LEFT_PANE_STYLE, { height: '100%' }]}>
          <WebBar
            state={state}
            navigation={navigation}
            tabBarStyle={tabBarStyle}
            descriptors={descriptors}
          />
        </View>
        <View style={[CONTENT_COLUMN_STYLE, { height: '100%' }]}>
          {state.routes.map((route, i) => {
            const isFocused = i === state.index;

            if (
              !isFocused &&
              !loadedRouteKeys.includes(route.key) &&
              !state.preloadedRouteKeys.includes(route.key)
            ) {
              return null;
            }

            return (
              <View
                key={route.key}
                style={[
                  StyleSheet.absoluteFill,
                  {
                    paddingHorizontal: 20,
                    display: isFocused ? 'flex' : 'none',
                    borderRightWidth: 1,
                    borderColor: 'black',
                  },
                ]}
              >
                {descriptors[route.key].render()}
              </View>
            );
          })}
        </View>
        {hasRightPane(windowWidth) &&
          <View style={[RIGHT_PANE_STYLE, { height: '100%' }]}>
            <RightPanel routeName={state.routes[state.index]?.name}/>
          </View>
        }
        <Scrollbar/>
      </View>
    </NavigationContent>
  );
};

function createWebNavigator(config?: unknown) {
  return createNavigatorFactory(WebNavigator)(config);
}

export {
  createWebNavigator,
  WebBarProps,
};
