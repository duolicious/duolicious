import {
  Animated,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faArrowLeft } from '@fortawesome/free-solid-svg-icons/faArrowLeft';
import { descriptionStyle } from './option-styles';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  NativeStackNavigationProp,
  NativeStackScreenProps,
  createNativeStackNavigator,
} from '@react-navigation/native-stack';
import type { RootParamList, WelcomeParamList } from '../navigation/linking';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DefaultText } from './default-text';
import { DefaultTextInput } from './default-text-input';
import { ButtonWithCenteredText } from './button/centered-text';
import { Close } from './button/close';
import { createAccountOptionGroups } from '../data/option-groups';
import { OptionScreen } from './option-screen';
import { StatusBarSpacer } from './status-bar-spacer';
import { japi } from '../api/api';
import {
  consumePendingAppleWebSignIn,
  signInWithApple,
  useGoogleSignIn,
} from '../api/social-auth';
import { applyAuthenticatedResponse } from '../api/auth';
import { socialAccountOptionGroups } from '../data/option-groups';
import { sessionToken } from '../kv-storage/session-token';
import { Logo16 } from './logo';
import { KeyboardDismissingView } from './keyboard-dismissing-view';
import { otpDestination } from '../App';
import { useSignedInUser } from '../events/signed-in-user';
import { joinClub } from '../club/club';
import { isMobile } from '../util/util';
import { setOptionScreenPayload } from '../navigation/option-screen-store';
import { showSignUp } from './modal/sign-up-modal';
import { lastEvent, listen } from '../events/events';
import { anonymousAnswers } from '../events/anonymous-answers';

type StatsResponse = {
  num_active_users: number,
};

type SessionTokenResponse = {
  session_token: string,
};

const useInModal = () =>
  useState(() => lastEvent<boolean>('show-sign-up') ?? false)[0];

const useSignUpMessage = (): string | null => {
  const [message, setMessage] = useState<string | null>(
    () => lastEvent<string | null>('sign-up-message') ?? null);

  useEffect(() => {
    return listen<string | null>(
      'sign-up-message',
      (x) => setMessage(x ?? null),
      true,
    );
  }, []);

  return message;
};

const activeMembersText = (
  numActiveMembers: number,
  minActiveMembers: number,
  minText: string,
) => {
  if (numActiveMembers < minActiveMembers) {
    return minText;
  } else {
    return (
      `${numActiveMembers.toLocaleString()} active member` +
      (numActiveMembers === 1 ? '' : 's')
    );
  }
};

const ActiveMembers = ({
  numActiveMembers,
  minActiveMembers,
  color,
  minText = 'on the Duolicious dating app',
}: {
  numActiveMembers: number,
  minActiveMembers: number
  color: string,
  minText?: string,
}) => {
  const opacity = useRef(new Animated.Value(1)).current;

  const [displayText, setDisplayText] = useState(
    activeMembersText(numActiveMembers, minActiveMembers, minText));

  const [nextDisplayText, setNextDisplayText] = useState(displayText);

  const isFirstRender = useRef(true);

  useEffect(() => {
    setNextDisplayText(
      activeMembersText(numActiveMembers, minActiveMembers, minText));
  }, [numActiveMembers, minActiveMembers]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false; // Mark as not first render anymore
      return; // Skip animation on first render
    }

    // Fade out, change text, and fade in sequence
    Animated.sequence([
      // Fade out
      Animated.timing(opacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true
      })
    ]).start(() => {
      setDisplayText(nextDisplayText);

      // Fade in
      Animated.timing(opacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true
      }).start();
    });
  }, [nextDisplayText]);

  return (
    <Animated.Text
      style={{
        textAlign: 'center',
        color,
        opacity,
        fontFamily: 'MontserratRegular',
      }}
    >
      {displayText}
    </Animated.Text>
  );
};

const Stack = createNativeStackNavigator();

const WelcomeScreen = () => {
  const { width: windowWidth } = useWindowDimensions();
  const inModal = useInModal();

  // Note: the "logged-in user lands on Welcome" redirect is handled centrally
  // by App.tsx's post-login effect (which runs on `signedInUser` changes and
  // also covers the deep-link-then-sign-in case). Doing it here too would
  // race with that effect.

  return (
    <View
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: '#70f',
        overflow: 'hidden',
      }}
    >
      {!inModal && Platform.OS === 'web' && windowWidth >= 950 && <>
        <img
          src="https://duolicious.app/assets/landing/left.svg"
          style={{
            position: 'absolute',
            bottom: '0',
            left: `-${75 + Math.max(0, (1380 - windowWidth) / 2)}px`,
            width: '500px',
            height: 'auto',
            objectFit: 'cover',
            backfaceVisibility: 'hidden',
            transition: 'transform 0.5s ease-out',
          }}
        >
        </img>
        <img
          src="https://duolicious.app/assets/landing/right.svg"
          style={{
            position: 'absolute',
            bottom: '0',
            right: `-${75 + Math.max(0, (1380 - windowWidth) / 2)}px`,
            width: '500px',
            height: 'auto',
            objectFit: 'cover',
            backfaceVisibility: 'hidden',
            transition: 'transform 0.5s ease-out',
          }}
        >
        </img>
      </>}
      <View
        style={{
          height: '100%',
          width: '100%',
          maxWidth: 600,
          alignSelf: 'center',
          overflow: 'visible',
        }}
      >
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="Welcome Screen" component={WelcomeScreen_} />
          <Stack.Screen
            name="Welcome Email Screen"
            component={EmailScreen_}
            options={{ title: 'Sign in with email' }}
          />
          <Stack.Screen
            name="Create Account Or Sign In Screen"
            component={OptionScreen}
            options={{ title: 'Sign in' }}
          />
        </Stack.Navigator>
      </View>
    </View>
  );
};

const InviteScreen = ({navigation, route}: NativeStackScreenProps<RootParamList, 'Invite Screen'>) => {
  const [loading, setLoading] = useState(false);
  const [signedInUser] = useSignedInUser();

  const clubName = route.params?.clubName as string | undefined;
  const [numUsers, setNumUsers] = useState<number | undefined>(undefined);

  if (typeof clubName !== 'string') {
    throw new Error('clubName should be a string');
  }

  const dismiss = () => {
    if (signedInUser) {
      navigation.reset({ routes: [{ name: 'Home' }] });
    } else if (Platform.OS === 'web') {
      navigation.reset({
        routes: [{ name: 'Home', state: { routes: [{ name: 'Search' }] } }],
      });
    } else {
      navigation.reset({ routes: [{ name: 'Welcome' }] });
    }
  };

  const submit = async () => {
    if (signedInUser) {
      setLoading(true);

      await joinClub(clubName, numUsers ?? 0, true);

      setLoading(false);

      navigation.reset({
        routes: [
          {
            name: "Home",
            state: {
              routes: [
                {
                  name: "Search"
                }
              ]
            }
          }
        ]
      });
    } else {
      navigation.reset({
        routes: [
          {
            name: 'Welcome',
            state: {
              routes: [
                {
                  name: 'Welcome Screen',
                  params: { clubName, numUsers }
                },
              ]
            },
          },
        ],
      });
    }
  };

  useEffect(() => {
    const updateNumUsers = async () => {
      const response = await japi<StatsResponse>(
          'GET',
          '/stats?club-name=' + encodeURIComponent(clubName));

      if (!response.ok)
        return;

      setNumUsers(response.json.num_active_users);
    };

    if (numUsers === undefined) {
      updateNumUsers();
    }
  }, [clubName, numUsers]);

  return (
    <SafeAreaView
      style={{
        backgroundColor: '#70f',
        width: '100%',
        height: '100%',
      }}
    >
      <KeyboardDismissingView
        style={{
          width: '100%',
          height: '100%',
          maxWidth: 600,
          alignSelf: 'center',
          flexDirection: 'column',
        }}
      >
        <View
          style={{
            marginTop: 10,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
          }}
        >
          <Logo16 size={32} rectSize={0.3} />
          <Text
            style={{
              color: 'white',
              alignSelf: 'center',
              fontFamily: 'TruenoBold',
              fontSize: 20,
            }}
            selectable={false}
          >
            Duolicious
          </Text>
        </View>
        <View
          style={{
            alignSelf: 'center',
            justifyContent: 'center',
            flex: 1,
            width: '100%',
            paddingHorizontal: 10,
          }}
        >
          <View
            style={{
              backgroundColor: 'white',
              borderRadius: 10,
              shadowOffset: {
                width: 0,
                height: 2,
              },
              shadowOpacity: 0.5,
              shadowRadius: 10,
              elevation: 3,
              paddingTop: 20,
              width: '100%',
              overflow: 'hidden',
            }}
          >
            <Close onPress={dismiss} color="black" />
            <View
              style={{
                alignSelf: 'center',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                width: '100%',
                paddingHorizontal: 10,
              }}
            >
              <DefaultText
                style={{
                  textAlign: 'center',
                  color: '#555',
                }}
              >
                You’re invited to join
              </DefaultText>
              <DefaultText
                style={{
                  textAlign: 'center',
                  color: 'black',
                  fontSize: 26,
                  fontWeight: 900,
                  flexShrink: 1,
                  width: '100%',
                }}
              >
                {clubName}
              </DefaultText>
              <ActiveMembers
                numActiveMembers={numUsers ?? -1}
                minActiveMembers={10}
                color="#555"
              />
            </View>
            <View
              style={{
                justifyContent: 'center',
                padding: 20,
                paddingTop: 40,
                alignSelf: 'flex-start',
                width: '100%',
              }}
            >
              <ButtonWithCenteredText
                onPress={submit}
                borderWidth={0}
                loading={loading}
              >
                <DefaultText disableTheme style={{fontWeight: '700'}}>
                  Accept Invite
                </DefaultText>
              </ButtonWithCenteredText>
              <DefaultText
                style={{
                  color: '#777',
                  textAlign: 'center',
                  alignSelf: 'center',
                  lineHeight: 28,
                }}
              >
                By joining you agree to our {}
                <DefaultText
                  disableTheme
                  style={{
                    fontWeight: '600',
                  }}
                  onPress={() => Linking.openURL('https://duolicious.app/terms')}
                >
                  Terms
                </DefaultText>
                {}, {}
                <DefaultText
                  disableTheme
                  style={{ fontWeight: '600' }}
                  onPress={() => Linking.openURL('https://duolicious.app/privacy')}
                >
                  Privacy Policy
                </DefaultText>
                {} and {}
                <DefaultText
                  disableTheme
                  style={{ fontWeight: '600' }}
                  onPress={() => Linking.openURL('https://duolicious.app/guidelines')}
                >
                  Community Guidelines
                </DefaultText>
              </DefaultText>
            </View>
          </View>
        </View>
      </KeyboardDismissingView>
    </SafeAreaView>
  );
};

type SocialProvider = 'google' | 'apple';

// Brand button with the icon pinned to the left edge and the label
// centered against the full button width. The centering is handled by
// `ButtonWithCenteredText`'s own flex layout — we just drop the icon
// in as an absolutely-positioned `extraChildren` so it sits over the
// (otherwise centered) text without shifting it.
//
// Text size / weight mirrors the bottom "Sign Up or Sign In" CTA
// (`fontSize: 16, fontWeight: '700'`) so all primary buttons in the
// onboarding flow look identical.
const PrimaryAuthButton = ({
  onPress,
  loading,
  icon,
  backgroundColor,
  textColor,
  children,
}: {
  onPress: () => void,
  loading: boolean,
  icon: React.ReactNode,
  backgroundColor: string,
  textColor: string,
  children: React.ReactNode,
}) => (
  <ButtonWithCenteredText
    onPress={onPress}
    loading={loading}
    backgroundColor={backgroundColor}
    textColor={textColor}
    borderColor="#000"
    borderWidth={1}
    containerStyle={{ marginTop: 0, marginBottom: 10 }}
    fontSize={16}
    textStyle={{ fontWeight: '700' }}
    extraChildren={
      <View
        style={{
          position: 'absolute',
          left: 18,
          top: 0,
          bottom: 0,
          justifyContent: 'center',
        }}
        pointerEvents="none"
      >
        {icon}
      </View>
    }
  >
    {children}
  </ButtonWithCenteredText>
);

const TermsBlurb = () => (
  <DefaultText
    style={{
      color: 'white',
      textAlign: 'center',
      alignSelf: 'center',
      lineHeight: 28,
    }}
  >
    By signing up you agree to our {}
    <DefaultText
      disableTheme
      style={{ fontWeight: '600' }}
      onPress={() => Linking.openURL('https://duolicious.app/terms')}
    >
      Terms
    </DefaultText>
    {}, {}
    <DefaultText
      disableTheme
      style={{ fontWeight: '600' }}
      onPress={() => Linking.openURL('https://duolicious.app/privacy')}
    >
      Privacy Policy
    </DefaultText>
    {} and {}
    <DefaultText
      disableTheme
      style={{ fontWeight: '600' }}
      onPress={() => Linking.openURL('https://duolicious.app/guidelines')}
    >
      Community Guidelines
    </DefaultText>
  </DefaultText>
);

const LogoHeader = () => (
  <View
    style={{
      marginTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 1,
    }}
  >
    <Logo16 size={32} rectSize={0.3} doAnimate={true} />
    <Text
      style={{
        color: 'white',
        alignSelf: 'center',
        fontFamily: 'TruenoBold',
        fontSize: 20,
      }}
      selectable={false}
    >
      Duolicious
    </Text>
  </View>
);

const Hero = ({
  clubName,
  numUsers,
  showTagline,
  showActiveMembers,
}: {
  clubName?: string,
  numUsers?: number,
  showTagline: boolean,
  showActiveMembers: boolean,
}) => (
  <View
    style={{
      alignSelf: 'center',
      alignItems: 'center',
      gap: 10,
      paddingTop: 20,
      paddingBottom: 10,
    }}
  >
    {showTagline &&
      <DefaultText
        style={{
          maxWidth: 320,
          textAlign: 'center',
          color: 'white',
          fontSize: 30,
          fontWeight: 900,
        }}
      >
        {clubName ?
          `Join ${clubName} on Duolicious` :
          'Cute dates & dank memes await...'}
      </DefaultText>
    }
    {showActiveMembers &&
      <ActiveMembers
        numActiveMembers={numUsers ?? -1}
        minActiveMembers={0}
        color="white"
        minText={'\xa0'}
      />
    }
  </View>
);

// Shared by the welcome and email screens to keep `num_active_users`
// fresh on mount when not already prefilled by an invite deep-link.
const useNumActiveUsers = (initial: number | undefined) => {
  const [numUsers, setNumUsers] = useState<number | undefined>(initial);
  useEffect(() => {
    if (numUsers !== undefined) return;
    (async () => {
      const response = await japi<StatsResponse>('GET', '/stats');
      if (response.ok) setNumUsers(response.json.num_active_users);
    })();
  }, [numUsers]);
  return numUsers;
};

// Posts a social provider's id_token to the backend and routes the user
// onward (Home for existing users, the onboarding wizard for new ones).
// Lives at module scope so both `WelcomeScreen_` and the web-return
// effect can share it without re-defining per render.
const finishSocialSignIn = async ({
  endpoint,
  body,
  clubName,
  navigation,
  setLoginStatus,
}: {
  endpoint: '/sign-in-with-google' | '/sign-in-with-apple',
  body: Record<string, unknown>,
  clubName: string | undefined,
  navigation: NativeStackNavigationProp<WelcomeParamList>,
  setLoginStatus: (s: string) => void,
}) => {
  const response = await japi<SessionTokenResponse>(
    'post',
    endpoint,
    {
      ...body,
      ...(clubName && { pending_club_name: clubName }),
    },
    { timeout: 9999 * 1000 },
  );

  if (!response.ok) {
    // 409 is the "you need to take an action first" path (email
    // unverified, or an existing OTP account has claimed this email):
    // the server returns a human-readable message that tells the user
    // exactly what to do. Surface it instead of a canned status string.
    const serverMessage =
      typeof response.text === 'string' ? response.text.trim() : '';
    setLoginStatus(
      response.status === 409 && serverMessage ? serverMessage :
      response.status === 401 ? 'Sign-in token couldn’t be verified' :
      response.status === 429 ? 'You’re doing that too much' :
      response.status === 460 ? 'Network blocked. Are you using a VPN?' :
      response.status === 461 ? 'Your account is banned' :
      'We couldn’t connect to Duolicious'
    );
    return;
  }

  const newSessionToken: string | undefined = response.json?.session_token;
  if (typeof newSessionToken !== 'string') {
    setLoginStatus('Server didn’t return a session token');
    return;
  }
  await sessionToken(newSessionToken);

  const outcome = await applyAuthenticatedResponse(
    response, newSessionToken);

  if (outcome === 'needs-onboarding') {
    setOptionScreenPayload('Create Account Or Sign In Screen', {
      optionGroups: socialAccountOptionGroups,
      showSkipButton: false,
      showCloseButton: false,
      showBackButton: true,
      backgroundColor: '#7700ff',
      color: '#ffffff',
    });
    navigation.navigate('Create Account Or Sign In Screen');
  }
};

const WelcomeScreen_ = ({navigation, route}: NativeStackScreenProps<WelcomeParamList, 'Welcome Screen'>) => {
  const clubName_ = (route.params?.clubName) as string | undefined;
  const numUsers = useNumActiveUsers(route.params?.numUsers);
  const inModal = useInModal();
  const signUpMessage = useSignUpMessage();

  const [loginStatus, setLoginStatus] = useState("");
  const [socialLoading, setSocialLoading] = useState<SocialProvider | null>(null);

  const googleSignIn = useGoogleSignIn();
  const { height: windowHeight } = useWindowDimensions();

  const onPressUseEmail = () => {
    // Pass `clubName` along only when it's set, so an ordinary visitor
    // gets a clean `/email` URL with no query string. `numUsers` is
    // display-only and irrelevant on the email page — omitting it
    // keeps it out of the URL bar.
    navigation.navigate(
      'Welcome Email Screen',
      clubName_ ? { clubName: clubName_ } : undefined,
    );
  };

  const onPressGoogle = async () => {
    // Silently ignore taps before the OAuth request has loaded — the user
    // would otherwise get a confusing "Google sign-in not ready" toast for
    // a state that resolves on its own within milliseconds.
    if (socialLoading || !googleSignIn.ready) return;
    setLoginStatus("");
    setSocialLoading('google');
    try {
      const result = await googleSignIn.promptForIdToken();
      if (!result.ok && !result.cancelled) {
        setLoginStatus(result.reason ?? 'Google sign-in failed');
        return;
      }
      if (!result.ok) return;
      await finishSocialSignIn({
        endpoint: '/sign-in-with-google',
        body: { id_token: result.idToken },
        clubName: clubName_,
        navigation,
        setLoginStatus,
      });
    } finally {
      setSocialLoading(null);
    }
  };

  const onPressApple = async () => {
    if (socialLoading) return;
    setLoginStatus("");
    setSocialLoading('apple');
    try {
      // On web this never resolves — the page is navigating to Apple,
      // and the sign-in is finished by the web-return effect below
      // when the backend's callback redirects us back here. iOS and
      // Android resolve normally.
      const result = await signInWithApple({ clubName: clubName_ ?? '' });
      if (!result.ok && !result.cancelled) {
        setLoginStatus(result.reason ?? 'Apple sign-in failed');
        return;
      }
      if (!result.ok) return;
      await finishSocialSignIn({
        endpoint: '/sign-in-with-apple',
        body: { identity_token: result.identityToken, nonce: result.nonce },
        clubName: clubName_,
        navigation,
        setLoginStatus,
      });
    } finally {
      setSocialLoading(null);
    }
  };

  // Completes a web Apple sign-in started by a prior tap of "Continue
  // with Apple": on web the full-page redirect to Apple tears down the
  // app, and Apple's callback redirects users back to the SPA root
  // (i.e. this screen) with the id_token in the query string. The
  // shared `finishSocialSignIn` handles the actual API call. iOS and
  // Android never enter this branch — their flows resolve in-place
  // inside `onPressApple` above. Runs once on mount; the consume call
  // strips the query params and clears the pending sessionStorage
  // entry, so a refresh won't replay it.
  useEffect(() => {
    const pending = consumePendingAppleWebSignIn();
    if (!pending) return;
    const { result, context } = pending;
    (async () => {
      setLoginStatus("");
      setSocialLoading('apple');
      try {
        if (!result.ok && !result.cancelled) {
          setLoginStatus(result.reason ?? 'Apple sign-in failed');
          return;
        }
        if (!result.ok) return;
        await finishSocialSignIn({
          endpoint: '/sign-in-with-apple',
          body: { identity_token: result.identityToken, nonce: result.nonce },
          clubName: context.clubName || undefined,
          navigation,
          setLoginStatus,
        });
      } finally {
        setSocialLoading(null);
      }
    })();
  }, []);

  return (
    <SafeAreaView
      style={{
        backgroundColor: '#70f',
        width: '100%',
        height: '100%',
        flexDirection: 'row',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <KeyboardDismissingView
        style={{
          width: '100%',
          height: '100%',
          alignSelf: 'center',
          flexDirection: 'column',
        }}
      >
        {inModal &&
          <Pressable
            onPress={() => showSignUp(false)}
            style={{ position: 'absolute', top: 0, right: 0, zIndex: 99 }}
          >
            <Ionicons
              style={{ margin: 10, fontSize: 30, color: 'white' }}
              name="close"
            />
          </Pressable>
        }
        <LogoHeader />
        {!inModal &&
          <Hero
            clubName={clubName_}
            numUsers={numUsers}
            showTagline={windowHeight > 460}
            showActiveMembers={windowHeight > 500}
          />
        }
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            paddingHorizontal: 20,
            width: '100%',
            alignSelf: 'center',
          }}
        >
          <DefaultText
            style={{
              color: 'white',
              textAlign: 'center',
              marginBottom: inModal ? 40 : 20,
              fontSize: inModal ? 36 : 20,
              fontWeight: inModal ? 900 : 700,
            }}
          >
            {inModal && signUpMessage ? signUpMessage : 'Join or sign in'}
          </DefaultText>
          <PrimaryAuthButton
            onPress={onPressUseEmail}
            loading={false}
            icon={<Ionicons name="mail-outline" size={22} color="#000000" />}
            backgroundColor="#ffffff"
            textColor="#000000"
          >
            Use email
          </PrimaryAuthButton>
          <PrimaryAuthButton
            onPress={onPressGoogle}
            loading={socialLoading === 'google'}
            icon={<Ionicons name="logo-google" size={22} color="#ffffff" />}
            backgroundColor="#000000"
            textColor="#ffffff"
          >
            Continue with Google
          </PrimaryAuthButton>
          <PrimaryAuthButton
            onPress={onPressApple}
            loading={socialLoading === 'apple'}
            icon={<Ionicons name="logo-apple" size={22} color="#ffffff" />}
            backgroundColor="#000000"
            textColor="#ffffff"
          >
            Continue with Apple
          </PrimaryAuthButton>
          <DefaultText
            style={{
              alignSelf: 'center',
              marginTop: 5,
              color: 'white',
              opacity: loginStatus !== "" ? 1 : 0,
            }}
          >
            {loginStatus || '\xa0'}
          </DefaultText>
        </View>
        <View
          style={{
            justifyContent: 'center',
            paddingHorizontal: 20,
            paddingBottom: 10,
            alignSelf: 'flex-start',
            width: '100%',
          }}
        >
          <TermsBlurb />
        </View>
      </KeyboardDismissingView>
    </SafeAreaView>
  );
};

const EmailScreen_ = ({navigation, route}: NativeStackScreenProps<WelcomeParamList, 'Welcome Email Screen'>) => {
  const clubName_ = (route.params?.clubName) as string | undefined;

  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loginStatus, setLoginStatus] = useState("");

  const { height: windowHeight } = useWindowDimensions();

  const setEmailSafely = (e: string) => {
    setEmail(e.replace(/\s/g, ''));
  };

  const submit = async (suffix?: string) => {
    const suffix_ = suffix ?? '';
    const email_ = email + (email.endsWith(suffix_) ? '' : suffix_);

    setLoginStatus("");
    setIsLoading(true);
    setEmailSafely(email_);
    otpDestination.value = email_;

    Keyboard.dismiss();

    const response = await japi<SessionTokenResponse>(
      'post',
      '/request-otp',
      {
        email: email_,
        ...(clubName_ && { pending_club_name: clubName_ }),
        ...(anonymousAnswers.length && { answers: anonymousAnswers }),
      },
      { timeout: 9999 * 1000 },
    );

    setIsLoading(false);

    if (response.ok) {
      await sessionToken(response.json.session_token);

      setOptionScreenPayload('Create Account Or Sign In Screen', {
        optionGroups: createAccountOptionGroups,
        showSkipButton: false,
        showCloseButton: false,
        showBackButton: true,
        backgroundColor: '#7700ff',
        color: '#ffffff',
      });
      navigation.navigate('Create Account Or Sign In Screen');
    } else {
      setLoginStatus(
        response.status === 400 ? 'We don’t support that email provider' :
        response.status === 429 ? 'You’re doing that too much' :
        response.status === 460 ? 'Network blocked. Are you using a VPN?' :
        response.status === 461 ? 'Your account is banned' :
        'We couldn’t connect to Duolicious'
      );
    }
  };

  const SuffixButton = useCallback(({suffix}: {suffix: string}) => (
    <ButtonWithCenteredText
      onPress={() => !isLoading && submit(suffix)}
      borderWidth={0}
      secondary={true}
      containerStyle={{
        marginTop: 0,
        marginBottom: 0,
        height: undefined,
      }}
      backgroundColor="rgb(228, 204, 255)"
      textStyle={{
        padding: 10,
        fontSize: 12,
        color: '#70f',
      }}
    >
      {suffix}
    </ButtonWithCenteredText>
  ), [isLoading, submit]);

  // Layout deliberately mirrors `OptionScreen` — back button + bold
  // title + description on top, focused input in the middle, single
  // `Continue` button at the bottom — so this page looks like the OTP
  // step and onboarding wizard that follow it.
  return (
    <SafeAreaView
      edges={['bottom', 'left', 'right']}
      style={{
        backgroundColor: '#7700ff',
        width: '100%',
        height: '100%',
      }}
    >
      <KeyboardDismissingView
        style={{
          height: '100%',
          width: '100%',
          maxWidth: 600,
          alignSelf: 'center',
        }}
      >
        <StatusBarSpacer/>
        <View
          style={{
            alignItems: 'center',
            paddingTop: 10,
            paddingBottom: 20,
          }}
        >
          <Pressable
            onPress={() => navigation.goBack()}
            style={{ position: 'absolute', top: 0, left: 0, zIndex: 99 }}
          >
            <FontAwesomeIcon
              style={{ margin: 15 }}
              icon={faArrowLeft}
              size={24}
              color="white"
            />
          </Pressable>
          <DefaultText
            disableTheme
            style={{
              textAlign: 'center',
              fontWeight: '700',
              fontSize: 28,
              color: 'white',
              paddingLeft: 40,
              paddingRight: 40,
            }}
          >
            Continue with email
          </DefaultText>
          <DefaultText
            disableTheme
            style={{
              ...descriptionStyle.style,
              color: 'white',
            }}
          >
            Enter your email address to join or sign in. We’ll send you a
            one-time password to confirm it.
          </DefaultText>
        </View>
        <View
          style={{
            flex: 1,
            justifyContent: 'center',
            paddingHorizontal: 20,
          }}
        >
          <DefaultTextInput
            placeholder="you@example.com"
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            autoCapitalize="none"
            inputMode="email"
            value={email}
            onChangeText={setEmailSafely}
            onSubmitEditing={isMobile() ? undefined : () => submit()}
            autoFocus={Platform.OS !== 'ios'}
          />
          <DefaultText
            style={{
              alignSelf: 'center',
              marginTop: 5,
              color: 'white',
              opacity: loginStatus !== "" ? 1 : 0,
            }}
          >
            {loginStatus || '\xa0'}
          </DefaultText>
          {windowHeight > 500 &&
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'center',
                marginTop: 5,
                gap: 10,
              }}
            >
              <SuffixButton suffix="@gmail.com" />
              <SuffixButton suffix="@proton.me" />
              <SuffixButton suffix="@yahoo.com" />
              <SuffixButton suffix="@hotmail.com" />
              <SuffixButton suffix="@outlook.com" />
            </View>
          }
        </View>
        <View
          style={{
            flexShrink: 1,
            justifyContent: 'flex-end',
            alignItems: 'center',
            padding: 10,
            paddingBottom: 20,
          }}
        >
          <ButtonWithCenteredText
            secondary
            onPress={() => submit()}
            loading={isLoading}
            containerStyle={{ width: '90%' }}
          >
            Continue
          </ButtonWithCenteredText>
        </View>
      </KeyboardDismissingView>
    </SafeAreaView>
  );
};

export {
  InviteScreen,
  WelcomeScreen,
  useNumActiveUsers,
};
