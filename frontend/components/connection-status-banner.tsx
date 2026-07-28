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

const HIDDEN_POSITION = -500;
const SLIDE_DURATION = 300;
const BACK_ONLINE_HOLD_MS = 3000;

type Banner = 'offline' | 'back-online';

const bannerText: Record<Banner, string> = {
  'offline': "You’re offline",
  'back-online': "You’re back online",
};

const bannerColor: Record<Banner, string> = {
  'offline': '#d10000',
  'back-online': '#00a000',
};

const ConnectionStatusBanner = () => {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(HIDDEN_POSITION);
  const [banner, setBanner] = useState<Banner | null>(null);
  const lastBannerRef = useRef<Banner>('offline');
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  if (banner !== null) {
    lastBannerRef.current = banner;
  }

  const displayedBanner = banner ?? lastBannerRef.current;

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
          top: 0,
          left: 0,
          right: 0,
          paddingTop: insets.top + 2,
          paddingBottom: 2,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: bannerColor[displayedBanner],
          zIndex: 1000,
          elevation: 9,
        },
        animatedStyle,
      ]}
    >
      <FontAwesomeIcon
        icon={faWifi}
        color="white"
        size={16}
      />
      <DefaultText
        style={{
          color: 'white',
          fontWeight: '700',
        }}
      >
        {bannerText[displayedBanner]}
      </DefaultText>
    </Animated.View>
  );
};

export {
  ConnectionStatusBanner,
};
