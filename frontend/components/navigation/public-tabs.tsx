import { showSignUp } from '../modal/sign-up-modal';
import { experimentVariant } from '../../api/experiments';

const PUBLIC_TAB_NAMES = ['Search', 'Q&A'];

const GATE_MESSAGES: Record<string, string> = {
  Feed: 'Join or sign in to see the feed',
  Inbox: 'Join or sign in to send messages',
  Visitors: 'Join or sign in to see who visits you',
  Profile: 'Join or sign in to make your profile',
};

const promptSignUpForTab = (tabName: string) => showSignUp(
  true,
  experimentVariant('tab-gate-message', ['control', 'named']) === 'named'
    ? GATE_MESSAGES[tabName]
    : undefined,
);

export { PUBLIC_TAB_NAMES, promptSignUpForTab };
