import {
  Platform,
} from 'react-native';
import {
  useMemo,
} from 'react';
import {
  DefaultTheme,
  NavigationContainer,
  ParamListBase,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeTabs } from './components/home-tabs';
import { SplashScreen } from './components/splash-screen';
import { ConnectionStatusBanner } from './components/connection-status-banner';
import { ConversationScreen } from './components/conversation-screen/conversation-screen';
import { UtilityScreen } from './components/utility-screen';
import { ProspectProfileScreen } from './components/prospect-profile-screen/prospect-profile-screen';
import { GalleryScreen } from './components/gallery-screen';
import { GlobalBackButton } from './components/global-back-button';
import { InviteScreen, WelcomeScreen } from './components/welcome-screen';
import { useInboxStats } from './chat/application-layer/hooks/inbox-stats';
import { ColorPickerModal } from './components/modal/color-picker-modal/color-picker-modal';
import { GifPickerModal } from './components/modal/gif-picker-modal';
import { EmojiPickerModal } from './components/modal/emoji-picker-modal';
import { ReportModal } from './components/modal/report-modal';
import { ImageCropper } from './components/image-cropper';
import { useClearAppIconBadgeOnMobile } from './notifications/mobile';
import { usePushTokenListenerOnMobile } from './notifications/notifications';
import { verificationWatcher } from './verification/verification';
import { Toast } from './components/toast';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createLinking } from './navigation/linking';
import { useScrollbarStyle } from './components/navigation/scroll-bar-hooks';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ErrorBoundary } from './components/error-boundary';
import { TooltipListener } from './components/tooltip';
import { VerificationCameraModal } from './components/verification-camera';
import { PointOfSaleModal } from './components/modal/point-of-sale-modal';
import { DateOfBirthConfirmationModal } from './components/modal/date-of-birth-confirmation-modal';
import { SignUpModal } from './components/modal/sign-up-modal';
import { SignUpBanner } from './components/sign-up-banner';
import { useAppThemeLoader, useAppTheme } from './app-theme/app-theme';
import { useAppStartup } from './app-startup/app-startup';
import { useAppNavigation } from './navigation/app-navigation';

verificationWatcher();

const Stack = createNativeStackNavigator();

const otpDestination = { value: '' };
const isImagePickerOpen = { value: false };

const navigationContainerRef = createNavigationContainerRef<ParamListBase>();

const App = () => {
  useAppThemeLoader();
  const { appTheme } = useAppTheme();

  const linking = useMemo(() => createLinking(), []);

  const {
    pendingPostLoginStateRef,
    bannerVisible,
    bannerProspectHandle,
    onNavigationReady,
    onNavigationStateChange,
  } = useAppNavigation(linking, navigationContainerRef);

  const {
    initialState,
    isLoading,
    serverStatus,
    onError,
  } = useAppStartup(linking, pendingPostLoginStateRef);

  usePushTokenListenerOnMobile();
  useClearAppIconBadgeOnMobile();
  useScrollbarStyle();

  // Only need live updates on web (for browser tab title)
  const stats = useInboxStats(Platform.OS === 'web');

  const numUnread =
    (stats?.numUnreadChats ?? 0) +
    (stats?.numUnreadIntros ?? 0);

  if (serverStatus !== "ok") {
    return <UtilityScreen serverStatus={serverStatus} />
  }

  const rehydratedInitialState = initialState ?
    { ...initialState, stale: true as const } :
    undefined;

  return (
    <ErrorBoundary onError={onError}>
      <SafeAreaProvider>
        {!isLoading && initialState !== undefined &&
          <GestureHandlerRootView>
            <KeyboardProvider>
            <NavigationContainer
              ref={navigationContainerRef}
              linking={linking}
              initialState={rehydratedInitialState}
              onReady={onNavigationReady}
              onStateChange={onNavigationStateChange}
              theme={{
                ...DefaultTheme,
                colors: {
                  ...DefaultTheme.colors,
                  background: appTheme.primaryColor,
                },
              }}
              documentTitle={{
                // The focused screen can set its own `title` option (e.g. the
                // prospect profile sets it to the prospect's name once the
                // API resolves) and we splice it in front of "Duolicious".
                // Screens that don't set a title fall through to the bare
                // app name.
                formatter: (options) => {
                  const prefix = numUnread ? `(${numUnread}) ` : '';
                  const screenTitle = options?.title;
                  return prefix + (
                    screenTitle ? `${screenTitle} - Duolicious` : 'Duolicious'
                  );
                },
              }}
            >
              <Stack.Navigator
                screenOptions={{
                  headerShown: false,
                  presentation: 'card',
                  navigationBarColor: appTheme.primaryColor,
                }}
              >
                <Stack.Screen
                  name="Welcome"
                  component={WelcomeScreen} />
                <Stack.Screen
                  name="Home"
                  component={HomeTabs} />
                <Stack.Screen
                  name="Conversation Screen"
                  component={ConversationScreen} />
                <Stack.Screen
                  name="Prospect Profile Screen"
                  component={ProspectProfileScreen} />
                <Stack.Screen
                  name="Gallery Screen"
                  component={GalleryScreen}
                  options={{
                    presentation: 'containedTransparentModal',
                    animation: 'none',
                  }} />
                <Stack.Screen
                  name="Invite Screen"
                  component={InviteScreen}
                  options={{ title: 'Invitation' }} />
              </Stack.Navigator>
            </NavigationContainer>
            <GlobalBackButton/>
            {bannerVisible && <SignUpBanner prospectHandle={bannerProspectHandle}/>}
            <TooltipListener/>
            <ReportModal/>
            <ImageCropper/>
            <ColorPickerModal/>
            <GifPickerModal/>
            <EmojiPickerModal/>
            <Toast/>
            <PointOfSaleModal/>
            <SignUpModal/>
            <VerificationCameraModal/>
            <DateOfBirthConfirmationModal/>
            </KeyboardProvider>
          </GestureHandlerRootView>
        }
        <SplashScreen loading={isLoading} />
        <ConnectionStatusBanner/>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
};

export default App;
export {
  isImagePickerOpen,
  navigationContainerRef,
  otpDestination,
};
