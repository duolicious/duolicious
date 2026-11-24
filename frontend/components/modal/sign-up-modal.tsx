import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { NavigationContainer, NavigationIndependentTree } from '@react-navigation/native';
import { DefaultModal } from './default-modal';
import { backgroundColors } from './background-colors';
import { WelcomeScreen } from '../welcome-screen';
import { listen, notify, lastEvent } from '../../events/events';
import { useSignedInUser } from '../../events/signed-in-user';
import { isMobile } from '../../util/util';
import { experimentVariant } from '../../api/experiments';

const showSignUp = (isVisible: boolean, message?: string) => {
  if (isVisible) {
    notify<string | null>('sign-up-message', message ?? null);
  }
  notify<boolean>('show-sign-up', isVisible);
};

const joinButtonLabel = (): string =>
  experimentVariant('join-button-label', ['control', 'free']) === 'free'
    ? 'Join\xa0free'
    : 'Join or\xa0sign\xa0in';

const JOIN_FREE_LABEL = 'Join\xa0free';

const hasDesktopJoinCard = (): boolean =>
  !isMobile() &&
  experimentVariant('desktop-join-card', ['control', 'card']) === 'card';

const hasMobileJoinBar = (): boolean =>
  isMobile() &&
  experimentVariant('mobile-join-bar', ['control', 'bar']) === 'bar';

const useShowSignUp = () => {
  const [isVisible, setIsVisible] = useState<boolean>(
    () => lastEvent<boolean>('show-sign-up') ?? false);

  useEffect(() => {
    return listen<boolean>(
      'show-sign-up',
      (x) => {
        if (x === undefined) {
          return;
        }

        setIsVisible(x);
      },
      true,
    );
  }, []);

  return [isVisible, setIsVisible] as const;
};

const SignUpModal = () => {
  const [isVisible] = useShowSignUp();
  const [signedInUser] = useSignedInUser();

  const onPressClose = useCallback(() => showSignUp(false), []);

  useEffect(() => {
    if (!isVisible) return;
    if (!signedInUser) return;

    showSignUp(false);
  }, [isVisible, signedInUser?.personUuid]);

  return (
    <DefaultModal
      transparent={true}
      visible={isVisible}
      onRequestClose={onPressClose}
    >
      <View
        style={{
          width: '100%',
          height: '100%',
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'row',
          paddingHorizontal: isMobile() ? 0 : 10,
          paddingVertical: isMobile() ? 0 : 20,
          ...backgroundColors.dark,
        }}
      >
        <View
          style={{
            flex: 1,
            width: '100%',
            maxWidth: isMobile() ? undefined : 600,
            maxHeight: isMobile() ? undefined : 900,
            height: '100%',
            borderRadius: isMobile() ? 0 : 10,
            overflow: 'hidden',
          }}
        >
          <NavigationIndependentTree>
            <NavigationContainer documentTitle={{ enabled: false }}>
              <WelcomeScreen />
            </NavigationContainer>
          </NavigationIndependentTree>
        </View>
      </View>
    </DefaultModal>
  );
};

export {
  JOIN_FREE_LABEL,
  hasDesktopJoinCard,
  hasMobileJoinBar,
  showSignUp,
  joinButtonLabel,
  useShowSignUp,
  SignUpModal,
};
