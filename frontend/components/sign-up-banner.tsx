import { useEffect, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { CrossFade, CrossFadeText } from './cross-fade';
import { DefaultText } from './default-text';
import { Logo16 } from './logo';
import { isMobile } from '../util/util';
import { useAppTheme } from '../app-theme/app-theme';
import { showSignUp } from './modal/sign-up-modal';
import { useNumActiveUsers } from './welcome-screen';
import { useBannerProspectName } from '../events/banner-prospect-name';
import { useSignUpBanner } from '../events/sign-up-banner';
import { COLUMN_MAX_WIDTH } from '../constants/constants';
import {
  CONTENT_COLUMN_STYLE,
  LEFT_PANE_STYLE,
  RIGHT_PANE_STYLE,
  hasRightPane,
} from './navigation/web-layout';

const SignUpBannerCard = ({ prospectHandle, overContentColumn }: {
  prospectHandle?: string
  overContentColumn: boolean
}) => {
  const { appTheme } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  const numActiveUsers = useNumActiveUsers(undefined);
  const prospectName = useBannerProspectName(prospectHandle);
  const [showNumActiveUsers, setShowNumActiveUsers] = useState(false);

  useEffect(() => {
    const interval = setInterval(
      () => setShowNumActiveUsers((s) => !s),
      5000
    );
    return () => clearInterval(interval);
  }, []);

  // Longer names blow out the button's width, so fall back to the default copy.
  const label = prospectName && prospectName.length <= 7
    ? `Message ${prospectName}`
    : `Join or\xa0sign\xa0in`;

  const signUpMessage = prospectName && prospectName.length <= 15
    ? `Join or sign in to message ${prospectName}`
    : undefined;

  return (
    <View
      style={{
        position: 'absolute',
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
            showFront={showNumActiveUsers && numActiveUsers !== undefined}
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
                  fontWeight: '700',
                  fontSize: 14,
                  textAlign: 'center',
                  textWrap: 'balance',
                }}
              >
                {'See members\u2011only profiles by joining or signing in'}
              </DefaultText>
            }
          />
          <View style={{ flex: 1 }}>
            <Pressable
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

const SignUpBanner = () => {
  const { target, prospectHandle } = useSignUpBanner();

  if (target === 'none') {
    return null;
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
