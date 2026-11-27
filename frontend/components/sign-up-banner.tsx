import { useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Pressable } from './pressable';
import { CrossFade, CrossFadeText } from './cross-fade';
import { DefaultText } from './default-text';
import { Logo16 } from './logo';
import { isMobile, viewportPosition } from '../util/util';
import { useAppTheme } from '../app-theme/app-theme';
import {
  JOIN_FREE_LABEL,
  hasDesktopJoinCard,
  hasMobileJoinBar,
  showSignUp,
} from './modal/sign-up-modal';
import { ButtonWithCenteredText } from './button/centered-text';
import { TAB_BAR_HEIGHT } from './navigation/tab-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BannerTarget } from '../events/sign-up-banner';
import { useNumActiveUsers } from './welcome-screen';
import { useBannerProspectName } from '../events/banner-prospect-name';
import { useSignUpBanner } from '../events/sign-up-banner';
import { useIsSignedOutCardShown } from './navigation/signed-out-card';
import { COLUMN_MAX_WIDTH } from '../constants/constants';
import {
  CONTENT_COLUMN_STYLE,
  LEFT_PANE_STYLE,
  RIGHT_PANE_STYLE,
  hasRightPane,
} from './navigation/web-layout';

const useProspectPrompt = (prospectHandle: string | undefined) => {
  const prospectName = useBannerProspectName(prospectHandle);

  return {
    // Longer names blow out the button's width, so fall back to the default copy.
    messageLabel: prospectName && prospectName.length <= 7
      ? `Message ${prospectName}`
      : undefined,
    signUpMessage: prospectName && prospectName.length <= 15
      ? `Join or sign in to message ${prospectName}`
      : undefined,
    caption: prospectName && prospectName.length <= 15
      ? `Join free to message ${prospectName}`
      : undefined,
  };
};

const SignUpBannerCard = ({ prospectHandle, overContentColumn }: {
  prospectHandle?: string
  overContentColumn: boolean
}) => {
  const { appTheme } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  const numActiveUsers = useNumActiveUsers(undefined);
  const isNumActiveUsersInPane = useIsSignedOutCardShown();
  const { messageLabel, signUpMessage } = useProspectPrompt(prospectHandle);
  const [showNumActiveUsers, setShowNumActiveUsers] = useState(false);
  const [cardWidth, setCardWidth] = useState<number>();

  const isNarrow =
    (cardWidth ?? Math.min(windowWidth, COLUMN_MAX_WIDTH)) < 400;

  useEffect(() => {
    const interval = setInterval(
      () => setShowNumActiveUsers((s) => !s),
      5000
    );
    return () => clearInterval(interval);
  }, []);

  const label = messageLabel ?? 'Join or\xa0sign\xa0in';

  return (
    <View
      style={{
        position: viewportPosition(),
        bottom: isMobile() ? 70 : 20,
        left: 0,
        right: 0,
        height: 100,
        flexDirection: 'row',
        justifyContent: 'center',
        zIndex: 999,
      }}
      pointerEvents="box-none"
    >
      {overContentColumn &&
        <View style={LEFT_PANE_STYLE} pointerEvents="none"/>
      }

      <View
        style={[
          overContentColumn ?
            CONTENT_COLUMN_STYLE :
            { width: '100%', maxWidth: COLUMN_MAX_WIDTH },
          {
            height: '100%',
            alignItems: 'center',
            paddingHorizontal: 3,
          },
        ]}
        pointerEvents="box-none"
      >
        <View
          onLayout={(e) => {
            const { width } = e.nativeEvent.layout;
            if (width > 0) {
              setCardWidth(width);
            }
          }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            width: '100%',
            height: '100%',
            backgroundColor: 'white',
            borderRadius: 15,
            borderWidth: 1,
            borderColor: 'black',
            paddingHorizontal: 20,
            gap: 14,
          }}
        >
          <CrossFade
            style={{ flex: 1 }}
            showFront={
              !isNumActiveUsersInPane &&
              showNumActiveUsers &&
              numActiveUsers !== undefined
            }
            minBackMs={5000}
            front={
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                }}
              >
                <Logo16 size={64} color={appTheme.brandColor} rectSize={0.3} />
                <View style={{ flexShrink: 1 }}>
                  <DefaultText style={{ fontWeight: '900', fontSize: 20 }}>
                    {numActiveUsers === undefined ? '\xa0' : numActiveUsers.toLocaleString()}
                  </DefaultText>
                  <DefaultText style={{ fontWeight: '600', fontSize: 14 }}>
                    Active Members
                  </DefaultText>
                </View>
              </View>
            }
            back={
              <DefaultText
                style={{
                  fontWeight: '900',
                  fontSize: isNarrow ? 14 : 18,
                  lineHeight: isNarrow ? 22 : undefined,
                  textAlign: 'center',
                  textWrap: 'balance',
                }}
              >
                {'See members-only profiles by joining'}
              </DefaultText>
            }
          />
          <View style={{ flex: 1 }}>
            <Pressable
              role="button"
              onPress={() => showSignUp(true, signUpMessage)}
              style={{
                backgroundColor: appTheme.brandColor,
                borderRadius: 999,
                paddingVertical: 16,
                paddingHorizontal: 16,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: appTheme.secondaryColor,
              }}
            >
              <CrossFadeText triggerKey={label} style={{ width: '100%' }}>
                <DefaultText
                  style={{
                    color: appTheme.primaryColor,
                    fontWeight: '700',
                    fontSize: 16,
                    textAlign: 'center',
                  }}
                >
                  {label}
                </DefaultText>
              </CrossFadeText>
            </Pressable>
          </View>
        </View>
      </View>

      {overContentColumn && hasRightPane(windowWidth) &&
        <View style={RIGHT_PANE_STYLE} pointerEvents="none"/>
      }
    </View>
  );
};

const JoinBar = ({ target, prospectHandle }: {
  target: BannerTarget
  prospectHandle?: string
}) => {
  const { appTheme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const numActiveUsers = useNumActiveUsers(undefined);
  const { messageLabel, signUpMessage, caption } =
    useProspectPrompt(prospectHandle);

  const isAboveTabBar = target === 'search';

  const numActiveUsersCaption = numActiveUsers === undefined
    ? '\xa0'
    : `${numActiveUsers.toLocaleString()} active members`;

  return (
    <View
      style={{
        position: viewportPosition(),
        bottom: isAboveTabBar ? TAB_BAR_HEIGHT + insets.bottom : 0,
        left: 0,
        right: 0,
        zIndex: 999,
        alignItems: 'center',
        paddingTop: 8,
        paddingHorizontal: 16,
        paddingBottom: isAboveTabBar ? 12 : 12 + insets.bottom,
        backgroundColor: appTheme.primaryColor,
        borderTopWidth: 1,
        borderTopColor: appTheme.interactiveBorderColor,
        borderBottomWidth: isAboveTabBar ? 1 : 0,
        borderBottomColor: appTheme.interactiveBorderColor,
      }}
    >
      <View style={{ width: '100%', maxWidth: COLUMN_MAX_WIDTH, gap: 6 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <Logo16 size={32} color={appTheme.brandColor} rectSize={0.3} />
          <DefaultText
            style={{ fontWeight: '600', fontSize: 14, flexShrink: 1 }}
          >
            {caption ?? numActiveUsersCaption}
          </DefaultText>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <ButtonWithCenteredText
            secondary={true}
            onPress={() => showSignUp(true, signUpMessage)}
            containerStyle={{ flex: 1, marginTop: 0, marginBottom: 0, height: 48 }}
            textStyle={{ fontWeight: '700' }}
          >
            Sign in
          </ButtonWithCenteredText>
          <ButtonWithCenteredText
            onPress={() => showSignUp(true, signUpMessage)}
            containerStyle={{ flex: 1, marginTop: 0, marginBottom: 0, height: 48 }}
            textStyle={{ fontWeight: '700' }}
          >
            {messageLabel ?? JOIN_FREE_LABEL}
          </ButtonWithCenteredText>
        </View>
      </View>
    </View>
  );
};

const SignUpBanner = () => {
  const { target, prospectHandle } = useSignUpBanner();

  if (target === 'none') {
    return null;
  }

  if (target === 'search' && hasDesktopJoinCard()) {
    return null;
  }

  if (hasMobileJoinBar()) {
    return <JoinBar target={target} prospectHandle={prospectHandle} />;
  }

  return (
    <SignUpBannerCard
      prospectHandle={prospectHandle}
      overContentColumn={target === 'search' && !isMobile()}
    />
  );
};

export {
  SignUpBanner,
};
