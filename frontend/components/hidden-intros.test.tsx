import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { Text } from 'react-native';
import { HiddenIntrosItem } from './inbox-item';
import { InboxList } from './inbox-tab';
import { notify } from '../events/events';
import { Conversation, Inbox } from '../chat/application-layer';
import {
  resetInboxSettings,
  setInboxSettings,
} from '../chat/application-layer/hooks/conversations';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual<object>('@react-navigation/native'),
  useNavigation: () => ({}),
}));

jest.mock('./avatar', () => ({ Avatar: () => null }));
jest.mock('./top-nav-bar', () => ({ TopNavBar: () => null }));
jest.mock('../chat/websocket-layer', () => ({
  EV_CHAT_WS_CLOSE: 'chat-ws-close',
  EV_CHAT_WS_OPEN: 'chat-ws-open',
  EV_CHAT_WS_RECEIVE: 'chat-ws-receive',
  EV_CHAT_WS_SEND_CLOSE: 'chat-ws-send-close',
  send: jest.fn(),
}));
jest.mock('../notifications/notifications', () => ({
  getAndRegisterPushToken: jest.fn(),
}));
jest.mock('./logo/logo-activity-indicator', () => ({ LogoActivityIndicator: () => null }));

const intro = (
  personUuid: string,
  lastMessage: string,
  hidden: boolean,
): Conversation => ({
  personUuid,
  urlSlug: null,
  name: personUuid,
  matchPercentage: 50,
  photoUuid: null,
  photoBlurhash: null,
  lastMessage,
  lastMessageRead: hidden,
  lastMessageTimestamp: new Date(),
  isAvailableUser: true,
  isVerified: false,
  location: 'intros',
  hidden,
  awaitingReply: false,
  matchesSearchFilters: true,
});

const inboxOf = (intros: Conversation[]): Inbox => ({
  chats: { conversations: [], conversationsMap: {} },
  intros: {
    conversations: intros,
    conversationsMap: Object.fromEntries(intros.map((c) => [c.personUuid, c])),
  },
  archive: { conversations: [], conversationsMap: {} },
  endTimestamp: null,
});

const textOf = (renderer: ReturnType<typeof create>): string =>
  renderer.root
    .findAllByType(Text)
    .flatMap((node: { props: { children: unknown } }) => [node.props.children].flat())
    .filter((child: unknown) => typeof child === 'string' || typeof child === 'number')
    .join('\n');

const renderInbox = async (
  intros: Conversation[],
): Promise<ReturnType<typeof create>> => {
  let renderer: ReturnType<typeof create>;

  await act(async () => {
    notify<Inbox>('inbox', inboxOf(intros));
    renderer = create(<InboxList />);
  });

  return renderer;
};

describe('hidden intros', () => {
  afterEach(() => {
    act(() => {
      resetInboxSettings();
      notify<Inbox | null>('inbox', null);
    });
  });

  const polite = intro('polite', 'Hey, I loved your answer about cats!', false);
  const rude1 = intro('rude1', 'first rude message', true);
  const rude2 = intro('rude2', 'second rude message', true);

  test('are summarised by one row at the bottom of Intros', async () => {
    const renderer = await renderInbox([polite, rude1, rude2]);
    const text = textOf(renderer);

    expect(text).toContain('Hey, I loved your answer about cats!');
    expect(text).toContain('Hidden intros');
    expect(renderer.root.findByType(HiddenIntrosItem).props.count).toBe(2);
    expect(text).not.toContain('first rude message');
    expect(text).not.toContain('second rude message');
  });

  test('leave no row when there are none', async () => {
    expect(textOf(await renderInbox([polite]))).not.toContain('Hidden intros');
  });

  test('stay out of Chats', async () => {
    const renderer = await renderInbox([polite, rude1]);

    act(() => { setInboxSettings({ sectionIndex: 1 }); });

    expect(textOf(renderer)).not.toContain('Hidden intros');
  });

  test('open in their own list, which a back button leaves', async () => {
    const renderer = await renderInbox([polite, rude1, rude2]);

    act(() => {
      renderer.root
        .findByType(HiddenIntrosItem)
        .findAll((node: { props: { onPress?: unknown } }) =>
          typeof node.props.onPress === 'function')[0]
        .props.onPress();
    });

    let text = textOf(renderer);

    expect(text).toContain('These intros might be rude');
    expect(text).toContain('first rude message');
    expect(text).toContain('second rude message');
    expect(text).toContain('No more hidden intros');
    expect(text).not.toContain('Hey, I loved your answer about cats!');
    expect(renderer.root.findAllByType(HiddenIntrosItem)).toHaveLength(0);

    act(() => { setInboxSettings({ showHidden: false }); });

    text = textOf(renderer);

    expect(text).toContain('Hey, I loved your answer about cats!');
    expect(text).not.toContain('first rude message');
  });
});
