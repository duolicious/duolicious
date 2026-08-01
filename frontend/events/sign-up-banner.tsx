import { useLayoutEffect, useState } from 'react';
import { listen, notify, lastEvent } from './events';

type BannerTarget = 'none' | 'search' | 'prospect';

type SignUpBannerState = {
  target: BannerTarget
  prospectHandle: string | undefined
};

const EVENT_KEY = 'sign-up-banner';

const HIDDEN: SignUpBannerState = { target: 'none', prospectHandle: undefined };

const setSignUpBanner = (state: SignUpBannerState) => {
  const prev = lastEvent<SignUpBannerState>(EVENT_KEY);

  if (
    prev &&
    prev.target === state.target &&
    prev.prospectHandle === state.prospectHandle
  ) {
    return;
  }

  notify<SignUpBannerState>(EVENT_KEY, state);
};

const useSignUpBanner = (): SignUpBannerState => {
  const [state, setState] = useState<SignUpBannerState>(
    () => lastEvent<SignUpBannerState>(EVENT_KEY) ?? HIDDEN,
  );

  useLayoutEffect(() => {
    return listen<SignUpBannerState>(EVENT_KEY, (s) => setState(s ?? HIDDEN), true);
  }, []);

  return state;
};

export {
  BannerTarget,
  SignUpBannerState,
  setSignUpBanner,
  useSignUpBanner,
};
