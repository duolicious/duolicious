import { Platform } from 'react-native';
import {
  BottomTabBarProps,
  createBottomTabNavigator,
} from '@react-navigation/bottom-tabs';
import { createWebNavigator } from './navigation/web-navigator';
import { TabBar } from './navigation/tab-bar';
import { SearchTab } from './search-tab';
import { QuizTab } from './quiz-tab';
import { ProfileTab } from './profile-tab';
import { InboxTab } from './inbox-tab';
import { FeedTab } from './feed-tab';
import { VisitorsTab } from './visitors-tab';
import { useIsWebLoggedOut, useSignedInUser } from '../events/signed-in-user';
import { isMobile } from '../util/util';
import { LockedTab } from './locked-tab';
import { landingTab } from '../util/trials';

const Tab = isMobile() ? createBottomTabNavigator() : createWebNavigator();

const HomeTabs = () => {
  const gated = useIsWebLoggedOut();
  const [signedInUser] = useSignedInUser();

  return (
    <Tab.Navigator
      initialRouteName={landingTab(signedInUser?.personId)}
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        animation: 'shift',
      }}
      tabBar={(props: BottomTabBarProps) => <TabBar {...props} />}

      // Without this, tabs appear blank about 5% of the time when switching
      // between them. ChatGPT suggests the react-native-screens and
      // bottom-tabs animation packages are racing to detach the screens.
      detachInactiveScreens={Platform.OS !== 'ios'}
    >
      <Tab.Screen name="Q&A" component={QuizTab} options={{ title: 'Q&A' }} />
      <Tab.Screen name="Search" component={SearchTab} options={{ title: 'Search' }} />
      <Tab.Screen name="Feed" component={gated ? LockedTab : FeedTab} options={{ title: 'Feed' }} />
      <Tab.Screen name="Inbox" component={gated ? LockedTab : InboxTab} options={{ title: 'Inbox' }} />
      <Tab.Screen name="Visitors" component={gated ? LockedTab : VisitorsTab} options={{ title: 'Visitors' }} />
      <Tab.Screen name="Profile" component={gated ? LockedTab : ProfileTab} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
};

export { HomeTabs };
