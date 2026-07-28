import { useEffect, useRef, useState } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesomeIcon } from '@fortawesome/react-native-fontawesome';
import { faWifi } from '@fortawesome/free-solid-svg-icons/faWifi';
import { listen } from '../events/events';
import { EV_NETWORK_IS_ONLINE } from '../network/network';
import { DefaultText } from './default-text';
import { ToastContainer } from './toast';
import { useAppTheme } from '../app-theme/app-theme';

const HIDDEN_POSITION = -500;
const SLIDE_DURATION = 300;
const BACK_ONLINE_HOLD_MS = 3000;

type Banner = 'offline' | 'back-online';

const bannerText: Record<Banner, string> = {
  'offline': "You're offline",
  'back-online': "You're back online",
};

const ConnectionStatusBanner = () => {
  const insets = useSafeAreaInsets();
  const { appTheme } = useAppTheme();
  const translateY = useSharedValue(HIDDEN_POSITION);
  const [banner, setBanner] = useState<Banner | null>(null);
  const lastBannerRef = useRef<Banner>('offline');
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  if (banner !== null) {
    lastBannerRef.current = banner;
  }

  useEffect(() => listen<boolean>(EV_NETWORK_IS_ONLINE, (isOnline) => {
    if (isOnline === undefined) {
      return;
    }

    clearTimeout(hideTimeoutRef.current);

    if (!isOnline) {
      setBanner('offline');
      return;
    }

    setBanner((prev) => prev === null ? null : 'back-online');

    hideTimeoutRef.current = setTimeout(
      () => setBanner(null),
      BACK_ONLINE_HOLD_MS,
    );
  }, true), []);

  useEffect(() => {
    translateY.value = withTiming(
      banner === null ? HIDDEN_POSITION : 0,
      { duration: SLIDE_DURATION },
    );
  }, [banner]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: insets.top,
          left: 0,
          right: 0,
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          elevation: 9,
        },
        animatedStyle,
      ]}
    >
      <ToastContainer>
        <FontAwesomeIcon
          icon={faWifi}
          color={appTheme.secondaryColor}
          size={20}
        />
        <DefaultText
          style={{
            color: appTheme.secondaryColor,
            fontWeight: '700',
          }}
        >
          {bannerText[banner ?? lastBannerRef.current]}
        </DefaultText>
      </ToastContainer>
    </Animated.View>
  );
};

export {
  ConnectionStatusBanner,
};
