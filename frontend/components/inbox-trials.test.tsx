import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { Text } from 'react-native';
import { IntrosItem } from './inbox-item';
import { InboxList } from './inbox-tab';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

let mockPersonId: number | undefined;
let mockSectionIndex = 0;
let mockConversations: string[] = [];
let mockNumAboveDivider: number | null = null;

jest.mock('../events/signed-in-user', () => ({
  getSignedInUser: () =>
    mockPersonId === undefined ? undefined : { personId: mockPersonId },
  useSignedInUser: () => [
    mockPersonId === undefined ? undefined : { personId: mockPersonId },
    () => {},
  ],
}));

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

jest.mock('../chat/application-layer/hooks/conversations', () => ({
  ...jest.requireActual<object>('../chat/application-layer/hooks/conversations'),
  useConversations: () => ({
    conversations: mockConversations,
    numAboveDivider: mockNumAboveDivider,
    sectionIndex: mockSectionIndex,
    sortByIndex: 0,
    showArchive: false,
    applySearchFilters: false,
  }),
}));

const renderedText = (element: React.ReactElement): string => {
  let renderer: ReturnType<typeof create>;

  act(() => { renderer = create(element); });

  return renderer.root
    .findAllByType(Text)
    .flatMap((node: { props: { children: unknown } }) => [node.props.children].flat())
    .filter((child: unknown) => typeof child === 'string')
    .join('\n');
};

const intro = (
  <IntrosItem
    wasRead={false}
    name="Intro Person"
    personUuid="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    urlSlug="introperson"
    photoUuid={null}
    photoBlurhash={null}
    matchPercentage={80}
    lastMessage="Hey, I loved your answer about cats!"
    lastMessageTimestamp={new Date()}
    isAvailableUser={true}
    isVerified={false}
  />
);

test('an intro shows the start of its message', () => {
  const text = renderedText(intro);

  expect(text).toContain('Hey, I loved your answer about cats!');
  expect(text).not.toContain('Wants to chat');
});

describe('the Chats dividers', () => {
  afterEach(() => {
    mockSectionIndex = 0;
    mockConversations = [];
    mockNumAboveDivider = null;
  });

  test('split replied conversations from those waiting for a reply', () => {
    mockSectionIndex = 1;
    mockConversations = ['replied', 'unreplied1', 'unreplied2'];
    mockNumAboveDivider = 1;

    const text = renderedText(<InboxList />);

    expect(text).toContain('Replied (1)');
    expect(text).toContain('Waiting for a reply (2)');
  });

  test('are absent without a split', () => {
    mockSectionIndex = 1;
    mockConversations = ['unreplied1', 'unreplied2'];

    const text = renderedText(<InboxList />);

    expect(text).not.toContain('Replied');
    expect(text).not.toContain('Waiting for a reply');
  });
});

describe('the empty Chats text', () => {
  afterEach(() => {
    mockPersonId = undefined;
    mockSectionIndex = 0;
  });

  test.each([390700, 390702])('says sent messages appear for person %p', (personId) => {
    mockPersonId = personId;
    mockSectionIndex = 1;

    const text = renderedText(<InboxList />);

    expect(text).toContain('Messages you send appear here straight away');
    expect(text).not.toContain('Chats start once both people have exchanged messages');
  });

  test.each([390701, 389200, undefined])('says chats need both people for person %p', (personId) => {
    mockPersonId = personId;
    mockSectionIndex = 1;

    const text = renderedText(<InboxList />);

    expect(text).toContain('Chats start once both people have exchanged messages');
    expect(text).not.toContain('Messages you send appear here straight away');
  });

  test('the Intros text is the same for both groups', () => {
    for (const personId of [390700, 390701]) {
      mockPersonId = personId;

      expect(renderedText(<InboxList />)).toContain('Once you reply, they’ll move to your Chats');
    }
  });
});
