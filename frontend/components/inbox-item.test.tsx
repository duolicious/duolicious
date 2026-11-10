import { expect, jest, test } from '@jest/globals';
import { Text } from 'react-native';
import { IntrosItem } from './inbox-item';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual<object>('@react-navigation/native'),
  useNavigation: () => ({}),
}));

jest.mock('./avatar', () => ({ Avatar: () => null }));
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
