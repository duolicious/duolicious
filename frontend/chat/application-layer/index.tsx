import { Platform } from 'react-native';
import { getRandomString } from '../../random/string';
import { deleteFromArray, assert } from '../../util/util';
import { listen, notify, lastEvent } from '../../events/events';
import { getAndRegisterPushToken } from '../../notifications/notifications';
import { notifyOnWeb } from '../../notifications/web';
import * as _ from 'lodash';
import {
  EV_CHAT_WS_CLOSE,
  EV_CHAT_WS_OPEN,
  EV_CHAT_WS_RECEIVE,
  EV_CHAT_WS_SEND_CLOSE,
  send,
} from '../websocket-layer';
import { notifyOwnLastMessageAt } from './hooks/read-receipt';
import { ingestMamReaction } from './hooks/reaction';
import {
  awaitFocusedConversationFetch,
  markConversationFetchDispatched,
} from '../conversation-priority';

const AUDIO_MESSAGE = 'Audio message';

const messageTimeout = 10000;
const fetchConversationTimeout = 15000;
const fetchInboxTimeout = 30000;

let credentials: null | {
  username: string
  password: string
} = null;

// The only place `credentials` is mutated, so a change is always observable.
const setCredentials = (next: typeof credentials) => {
  credentials = next;
  notify('chat-has-credentials', !!credentials);
};

// Whether the client may subscribe to other people's online status. Logged-in
// users subscribe once XMPP authentication completes (so skip-checks apply).
// Logged-out web users may subscribe as soon as the socket is open, but the
// server only honours their subscriptions for `public_profile` users.
//
// It's fully derived from its three inputs, so it's recomputed whenever any of
// them changes rather than hand-called at each mutation site.
const recomputeOnlineSubscribable = () => {
  const authenticated = !!lastEvent('chat-is-online');
  const webSocketOpen = !!lastEvent('chat-is-websocket-open');
  const loggedOutOnWeb = Platform.OS === 'web' && !credentials;

  notify('online-subscribable', webSocketOpen && (authenticated || loggedOutOnWeb));
};

listen('chat-is-online', recomputeOnlineSubscribable);
listen('chat-is-websocket-open', recomputeOnlineSubscribable);
listen('chat-has-credentials', recomputeOnlineSubscribable);

notify('chat-is-websocket-open', false);
notify('chat-has-credentials', false);
notify('inbox', null);

const jidMatchesSignedInUser = (jid: string) => {
  return jidToBareJid(jid) === credentials?.username;
}

const findEarliestDate = (dates: Date[]): Date | null => {
  // Check if the dates array is empty
  if (dates.length === 0) {
    return null;
  }

  // Convert each Date object to a timestamp, find the minimum, and convert back to a Date object
  const earliestTimestamp = Math.min(...dates.map(date => date.getTime()));
  return new Date(earliestTimestamp);
};

const findEarliestDateInConversations = (conversations: Conversation[]) => {
  const timestamps = conversations.map(c => c.lastMessageTimestamp);
  return findEarliestDate(timestamps);
}

const isValidUuid = (uuid: string): boolean => {
  const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return regex.test(uuid);
}


// TODO: Catch more exceptions. If a network request fails, that shouldn't crash the app.
// TODO: Update match percentages when user answers some questions

type MessageStatus =
  | 'sending'
  | 'sent'
  | 'offensive'
  | 'rate-limited-1day'
  | 'rate-limited-1day-unverified-basics'
  | 'rate-limited-1day-unverified-photos'
  | 'voice-intro'
  | 'server-error'
  | 'spam'
  | 'age-verification'
  | 'blocked'
  | 'not unique'
  | 'too long'
  | 'timeout'

type ChatBaseMessage = {
  from: string
  to: string
  fromCurrentUser: boolean
  id: string
  mamId?: string
  timestamp: Date
};

type ChatAudioMessage = ChatBaseMessage & {
  type: 'chat-audio'
  audioUuid: string
};

type ChatTextMessage = ChatBaseMessage & {
  type: 'chat-text'
  text: string
};

type ChatMessage = ChatAudioMessage | ChatTextMessage;

type TypingMessage = {
  from: string
  to: string
  id: string
  type: 'typing'
};

type Message = ChatMessage | TypingMessage

type Conversation = {
  personUuid: string
  urlSlug: string | null
  name: string
  matchPercentage: number
  photoUuid: string | null
  photoBlurhash: string | null
  lastMessage: string
  lastMessageRead: boolean
  lastMessageTimestamp: Date
  isAvailableUser: boolean
  isVerified: boolean
  location: 'chats' | 'intros' | 'archive' | 'nowhere'
  matchesSearchFilters: boolean
};

type ConversationsMap = { [key: string]: Conversation };

type Conversations = {
  conversations: Conversation[]
  conversationsMap: ConversationsMap
};

type Inbox = {
  chats: Conversations
  intros: Conversations
  archive: Conversations
  endTimestamp: Date | null
};

const getInbox = (): Inbox | null => {
  return lastEvent<Inbox | null>('inbox') ?? null;
}

const inboxStats = (inbox: Inbox): {
  numChats: number
  numUnreadChats: number
  numIntros: number
  numUnreadIntros: number
  numArchive: number
  numUnreadArchive: number
  numChatsAndIntros: number
  numUnreadChatsAndIntros: number
} => {
  const unreadAcc = (sum: number, c: Conversation) =>
    sum + (!c.lastMessageRead ? 1 : 0);

  const unreadSum = (conversations: Conversation[]) =>
    conversations.reduce(unreadAcc, 0);

  const numChats = inbox.chats.conversations.length;
  const numIntros = inbox.intros.conversations.length;
  const numArchive = inbox.archive.conversations.length;
  const numChatsAndIntros = numChats + numIntros;

  const numUnreadChats = unreadSum(inbox.chats.conversations);
  const numUnreadIntros = unreadSum(inbox.intros.conversations);
  const numUnreadArchive = unreadSum(inbox.archive.conversations);
  const numUnreadChatsAndIntros = numUnreadChats + numUnreadIntros;

  return {
    numChats,
    numUnreadChats,
    numIntros,
    numUnreadIntros,
    numArchive,
    numUnreadArchive,
    numChatsAndIntros,
    numUnreadChatsAndIntros,
  };
};

// A deep clone of the current inbox, ready for in-place mutation - or `null`
// when the inbox hasn't loaded yet. Incremental updates (a sent/received
// message, a read receipt, an archive) must go through this so they never
// fabricate an inbox while it's still loading: a `null` inbox is what tells the
// UI to show its loading spinner, and manufacturing an empty one instead flips
// it to the "no conversations" empty state for the rest of the load. There's
// nothing to preserve anyway - `refreshInbox` replaces the whole inbox with the
// authoritative server snapshot moments later.
const cloneInboxForUpdate = (): Inbox | null => {
  const inbox = getInbox();
  return inbox === null ? null : _.cloneDeep(inbox);
};

const conversationListToMap = (
  conversationList: Conversation[]
): ConversationsMap => {
  return conversationList.reduce<ConversationsMap>(
    (obj, item) => { obj[item.personUuid] = item; return obj; },
    {}
  );
};

// Builds a `Conversation` from the complete, snake-cased conversation objects
// the server sends in `duo_inbox` snapshots and `duo_inbox_entry` pushes.
const conversationFromWire = (
  c: any, // eslint-disable-line @typescript-eslint/no-explicit-any
): Conversation | null => {
  if (typeof c?.person_uuid !== 'string') {
    return null;
  }

  const locations = ['chats', 'intros', 'archive', 'nowhere'];

  return {
    personUuid: c.person_uuid,
    urlSlug: c.url_slug ?? null,
    name: c.name ?? 'Unavailable Person',
    matchPercentage: c.match_percentage ?? 0,
    photoUuid: c.image_uuid ?? null,
    photoBlurhash: c.image_blurhash ?? null,
    lastMessage: c.last_message ?? '',
    lastMessageRead: !!c.last_message_read,
    lastMessageTimestamp: new Date(c.last_message_timestamp),
    isAvailableUser: !!c.is_available,
    isVerified: !!c.is_verified,
    location: locations.includes(c.location) ? c.location : 'archive',
    matchesSearchFilters: !!(c.matches_search_filters ?? true),
  };
};

const jidToBareJid = (jid: string): string =>
  jid.split('@')[0];

const personUuidToJid = (personUuid: string): string =>
  `${personUuid}@duolicious.app`;

const setInboxSent = (recipientPersonUuid: string, message: string) => {
  const i = cloneInboxForUpdate();
  if (!i) return;

  const chatsConversation =
    i.chats.conversationsMap[recipientPersonUuid] as Conversation | undefined;
  const introsConversation =
    i.intros.conversationsMap[recipientPersonUuid] as Conversation | undefined;

  const updatedConversation: Conversation = {
    personUuid: recipientPersonUuid,
    urlSlug: null,
    name: '',
    matchPercentage: 0,
    photoUuid: null,
    isAvailableUser: true,
    location: 'archive',
    photoBlurhash: '',
    isVerified: false,
    matchesSearchFilters: true,
    ...chatsConversation,
    ...introsConversation,
    lastMessage: message,
    lastMessageRead: true,
    lastMessageTimestamp: new Date(),
  };

  // It's a new conversation. It will remain hidden until someone replies
  if (!chatsConversation && !introsConversation) {
    updatedConversation.location = 'nowhere';
  }
  // It was an intro before the new message. Move it to chats
  else if (!chatsConversation) {
    updatedConversation.location = 'chats';

    i.chats.conversationsMap[recipientPersonUuid] = updatedConversation;
    i.chats.conversations = Object.values(i.chats.conversationsMap);

    // Remove conversation from intros
    deleteFromArray(i.intros.conversations, introsConversation);
    delete i.intros.conversationsMap[recipientPersonUuid];
  }
  // It was a chat before the new message. Update the chat.
  else {
    Object.assign(chatsConversation, updatedConversation);
  }

  // We could've returned `i` instead of a shallow copy. But then it
  // wouldn't trigger re-renders when passed to a useState setter.
  notify<Inbox>('inbox', {...i});
};

// Merges a complete conversation (pushed by the server as `duo_inbox_entry`
// when a message arrives) into the inbox. The server's copy is authoritative,
// so there's nothing left to fetch, even when the sender is a new person.
const setInboxRecieved = (conversation: Conversation) => {
  const inbox = cloneInboxForUpdate();
  if (!inbox) return;

  const conversations = [
    ...inbox.chats.conversations,
    ...inbox.intros.conversations,
    ...inbox.archive.conversations,
  ].filter((c) => c.personUuid !== conversation.personUuid);

  conversations.push(conversation);

  notifyOnWeb(conversation.name, conversation.lastMessage);

  notify<Inbox>('inbox', conversationsToInbox(conversations));
};

const onReceiveInboxEntry = (doc: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (doc?.duo_inbox_entry === undefined) {
    return;
  }

  try {
    const conversation = conversationFromWire(doc.duo_inbox_entry);

    if (conversation) {
      setInboxRecieved(conversation);
    }
  } catch { }
};

const setInboxDisplayed = (fromPersonUuid: string) => {
  const inbox = cloneInboxForUpdate();
  if (!inbox) return;

  const chatsConversation =
    inbox.chats.conversationsMap[fromPersonUuid] as Conversation | undefined;
  const introsConversation =
    inbox.intros.conversationsMap[fromPersonUuid] as Conversation | undefined;
  const archiveConversation =
    inbox.archive.conversationsMap[fromPersonUuid] as Conversation | undefined;

  const updatedConversation = {
    ...chatsConversation,
    ...introsConversation,
    ...archiveConversation,
    lastMessageRead: true,
  };

  if (chatsConversation) {
    Object.assign(chatsConversation, updatedConversation);
  }
  if (introsConversation) {
    Object.assign(introsConversation, updatedConversation);
  }
  if (archiveConversation) {
    Object.assign(archiveConversation, updatedConversation);
  }

  // We could've returned `inbox` instead of a shallow copy. But then it
  // wouldn't trigger re-renders when passed to a useState setter.
  notify<Inbox>('inbox', {...inbox});
};

const login = async (
  username: string,
  password: string,
) => {
  setCredentials({ username, password });

  authenticate();
};

const logout = async () => {
  setCredentials(null);
  await registerPushToken(null);
  notify(EV_CHAT_WS_SEND_CLOSE);
  notify<Inbox | null>('inbox', null);
};

const authenticate = async () => {
  if (!credentials) {
    return;
  }

  if (lastEvent('chat-is-online')) {
    return;
  }

  const data = {
    auth: {
      "@xmlns": "urn:ietf:params:xml:ns:xmpp-sasl",
      "@mechanism": "PLAIN",
      "#text": btoa(`\0${credentials.username}\0${credentials.password}`),
    }
  };

  const status = await send({ data });

  if (status === 'timeout') {
    return;
  }

  notify('chat-is-online', true);

  await Promise.all([
    refreshInbox(),
    getAndRegisterPushToken(),
  ]);
};

const markDisplayed = async (message: ChatMessage) => {
  if (message.fromCurrentUser) return;

  if (!isValidUuid(jidToBareJid(message.from))) return;
  if (!isValidUuid(jidToBareJid(message.to))) return;

  const data = {
    message: {
      '@to': message.from,
      '@from': message.to,
      displayed: {
        '@xmlns': 'urn:xmpp:chat-markers:0',
        '@id': message.id,
      },
    }
  };

  await send({ data });

  setInboxDisplayed(jidToBareJid(message.from));
};

const sendMessage = async (
  recipientPersonUuid: string,
  content: {
    type: 'chat-text',
    text: string,
  } | {
    type: 'chat-audio',
    audioBase64: string,
  } | {
    type: 'typing',
  },
  id: string,
  config?: {
    numTries?: number,
    timeoutMs?: number,
  },
): Promise<
  | { message: Message, status: 'sent' }
  | { message: null, status: 'not unique', usedCount: number }
  | { message: null, status: Exclude<MessageStatus, 'sent' | 'sending' | 'not unique'> }
> => {
  const {
    numTries = 3,
    timeoutMs = messageTimeout,
  } = config ?? {};

  if (numTries <= 0) {
    return { message: null, status: 'timeout' };
  }

  if (!credentials) {
    return { message: null, status: 'blocked' };
  }

  const data = (() => {
    if (content.type === 'typing') {
      return {
        message: {
          '@xmlns': 'jabber:client',
          '@type': 'typing',
          '@from': personUuidToJid(credentials.username),
          '@to': personUuidToJid(recipientPersonUuid),
          '@id': id,
        }
      };
    } else if (content.type === 'chat-text') {
      return {
        message: {
          '@xmlns': 'jabber:client',
          '@type': 'chat',
          '@from': personUuidToJid(credentials.username),
          '@to': personUuidToJid(recipientPersonUuid),
          '@id': id,
          body: content.text,
        },
      };
    } else if (content.type === 'chat-audio') {
      return {
        message: {
          '@xmlns': 'jabber:client',
          '@type': 'chat',
          '@from': personUuidToJid(credentials.username),
          '@to': personUuidToJid(recipientPersonUuid),
          '@id': id,
          '@audio_base64': content.audioBase64,
        },
      };
    } else {
      throw new Error('Unhandled content type');
    }
  })();

  type MessageDetectionResult =
    | { status: 'not unique', usedCount: number }
    | { status: Exclude<MessageStatus, 'sent' | 'sending' | 'timeout' | 'not unique'> }
    | { status: 'sent', audioUuid?: string, stamp?: string, mamId?: string };

  const responseDetector = (doc: any): MessageDetectionResult | null => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const detectors: (() => MessageDetectionResult | false)[] = [
      () => doc.duo_message_delivered?.['@id'] === id &&
        {
          status: 'sent',
          audioUuid: doc.duo_message_delivered?.['@audio_uuid'],
          stamp: doc.duo_message_delivered?.['@stamp'],
          mamId: doc.duo_message_delivered?.['@mam_id'],
        },
      () => doc.duo_message_blocked?.['@reason'] === 'offensive' &&
        { status: 'offensive' },
      () => doc.duo_message_blocked?.['@id'] === id &&
        doc.duo_message_blocked?.['@reason'] === 'rate-limited-1day' &&
        !doc.duo_message_blocked?.['@subreason'] &&
        { status: 'rate-limited-1day' },
      () => doc.duo_message_blocked?.['@id'] === id &&
        doc.duo_message_blocked?.['@reason'] === 'rate-limited-1day' &&
        doc.duo_message_blocked?.['@subreason'] === 'unverified-basics' &&
        { status: 'rate-limited-1day-unverified-basics' },
      () => doc.duo_message_blocked?.['@id'] === id &&
        doc.duo_message_blocked?.['@reason'] === 'rate-limited-1day' &&
        doc.duo_message_blocked?.['@subreason'] === 'unverified-photos' &&
        { status: 'rate-limited-1day-unverified-photos' },
      () => doc.duo_message_blocked?.['@id'] === id &&
        doc.duo_message_blocked?.['@reason'] === 'voice-intro' &&
        { status: 'voice-intro' },
      () => doc.duo_message_blocked?.['@id'] === id &&
        doc.duo_message_blocked?.['@reason'] === 'spam' &&
        { status: 'spam' },
      () => doc.duo_message_blocked?.['@id'] === id &&
        doc.duo_message_blocked?.['@reason'] === 'age-verification' &&
        { status: 'age-verification' },
      () =>
        // Fallback for any blocked case not caught above.
        doc.duo_message_blocked?.['@id'] === id &&
        doc.duo_message_blocked !== undefined &&
        { status: 'blocked' },
      () => doc.duo_message_not_unique?.['@id'] === id &&
        doc.duo_message_not_unique !== undefined &&
        { status: 'not unique', usedCount: Number(doc.duo_message_not_unique['@used_count']) },
      () => doc.duo_message_too_long?.['@id'] === id &&
        doc.duo_message_too_long !== undefined &&
        { status: 'too long' },
      () => doc.duo_server_error?.['@id'] === id &&
        doc.duo_server_error !== undefined &&
        { status: 'server-error' },
    ];

    for (const detect of detectors) {
      const result = detect();
      if (result) return result;
    }

    return null;
  };

  if (content.type === 'typing') {
    await send({ data, timeoutMs });

    return {
      message: {
        type: 'typing',
        from: personUuidToJid(credentials.username),
        to: personUuidToJid(recipientPersonUuid),
        id,
      },
      status: 'sent', // Deliberately ignore timeouts for typing indicators
    };
  }

  const response = await send({ data, responseDetector, timeoutMs });

  if (response === 'timeout') {
    ;
  } else if (response.status === 'sent' && response.audioUuid) {
    const timestamp = response.stamp ? new Date(response.stamp) : new Date();

    setInboxSent(recipientPersonUuid, AUDIO_MESSAGE);

    notify(`message-to-${recipientPersonUuid}`);

    // Our message is now the conversation's last one, so a receipt for it can
    // be shown once it's read.
    notifyOwnLastMessageAt(recipientPersonUuid, timestamp);

    return {
      message: {
        type: 'chat-audio',
        from: personUuidToJid(credentials.username),
        to: personUuidToJid(recipientPersonUuid),
        id,
        mamId: response.mamId || undefined,
        audioUuid: response.audioUuid,
        timestamp,
        fromCurrentUser: true,
      },
      status: response.status,
    };
  } else if (response.status === 'sent') {
    const text = content.type === 'chat-text' ? content.text : '';
    const timestamp = response.stamp ? new Date(response.stamp) : new Date();

    setInboxSent(recipientPersonUuid, text);

    notify(`message-to-${recipientPersonUuid}`);

    // Our message is now the conversation's last one, so a receipt for it can
    // be shown once it's read.
    notifyOwnLastMessageAt(recipientPersonUuid, timestamp);

    return {
      message: {
        type: 'chat-text',
        from: personUuidToJid(credentials.username),
        to: personUuidToJid(recipientPersonUuid),
        id,
        mamId: response.mamId || undefined,
        text,
        timestamp,
        fromCurrentUser: true,
      },
      status: response.status
    };
  } else if (response.status === 'not unique') {
    return { message: null, status: 'not unique', usedCount: response.usedCount };
  } else {
    return { message: null, status: response.status };
  }

  // Deal with timeouts. To stop ourselves from sending the same message
  // multiple times, we fetch the conversation history and see if the message
  // we're trying to send is already there. If not, we try to send it again.
  const conversation = await fetchConversation(recipientPersonUuid);

  if (
    conversation === 'timeout' ||
    conversation[conversation.length - 1]?.id !== id
  ) {
    return sendMessage(
      recipientPersonUuid,
      content,
      id,
      {
        numTries: numTries - 1,
        timeoutMs,
      }
    );
  } else {
    return { message: null, status: 'timeout' };
  }
};

const conversationsToInbox = (conversations: Conversation[]): Inbox => {
  const chats = conversations
    .filter((c) => c.location === 'chats');
  const intros = conversations
    .filter((c) => c.location === 'intros');
  const archive = conversations
    .filter((c) => c.location === 'archive');

  const inbox: Inbox = {
    chats: {
      conversations: chats,
      conversationsMap: conversationListToMap(chats),
    },
    intros: {
      conversations: intros,
      conversationsMap: conversationListToMap(intros),
    },
    archive: {
      conversations: archive,
      conversationsMap: conversationListToMap(archive),
    },
    endTimestamp: findEarliestDateInConversations(conversations),
  };

  return inbox;
};

const setConversationArchived = (personUuid: string, isSkipped: boolean) => {
  const inbox = cloneInboxForUpdate();
  if (!inbox) return;

  const conversationToUpdate = (
    inbox.chats .conversationsMap[personUuid] ??
    inbox.intros.conversationsMap[personUuid] ??
    inbox.archive.conversationsMap[personUuid]
  ) as Conversation | undefined;

  if (!conversationToUpdate) {
    return;
  }

  if (!isSkipped) {
    refreshInbox();
    return;
  }

  conversationToUpdate.location = 'archive';

  const inbox_ = conversationsToInbox([
    ...inbox.chats.conversations,
    ...inbox.intros.conversations,
    ...inbox.archive.conversations,
  ]);

  notify<Inbox>('inbox', inbox_);
};

const onReceiveMessage = (
  callback?: (message: Message) => void,
  otherPersonUuid?: string,
  doMarkDisplayed?: boolean,
): (() => void) | undefined => {
  const unpackDoc = (doc: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const {
        message: {
          '@type': type,
          '@from': from,
          '@to': to,
          '@id': id,
          '@audio_uuid': audioUuid,
          '@mam_id': mamId,
          body: text,
        }
      } = doc;

      const base = {
        from: from as string,
        to: to as string,
        id: id as string,
        mamId: (mamId || undefined) as string | undefined,
      };

      if (type === 'chat' && audioUuid) {
        return {
          ...base,
          type: 'chat-audio' as 'chat-audio',
          audioUuid: audioUuid,
        };
      }

      if (type === 'chat' && text){
        return {
          ...base,
          type: 'chat-text' as 'chat-text',
          text: text as string,
        };
      }

      if (type === 'typing') {
        return {
          ...base,
          type: 'typing' as 'typing',
        };
      }
    } catch { }

    return null;
  };

  const _onReceiveMessage = async (doc: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const unpacked = unpackDoc(doc);

    if (!unpacked) {
      return;
    }

    const bareFrom = jidToBareJid(unpacked.from)

    if (otherPersonUuid !== undefined && otherPersonUuid !== bareFrom) {
      return;
    }

    if (unpacked.type === 'typing' && callback !== undefined) {
      const message: TypingMessage = unpacked;

      callback(message);
    }

    if (unpacked.type === 'typing') {
      return;
    }

    const message: ChatMessage = unpacked.type === 'chat-text' ? {
      ...unpacked,
      type: 'chat-text',
      timestamp: new Date(),
      fromCurrentUser: jidMatchesSignedInUser(unpacked.from),
    } : {
      ...unpacked,
      type: 'chat-audio',
      timestamp: new Date(),
      fromCurrentUser: jidMatchesSignedInUser(unpacked.from),
    };

    // The inbox itself is updated by the `duo_inbox_entry` the server pushes
    // just before each message, so only the message event is emitted here.
    if (otherPersonUuid === undefined) {
      notify(`message-from-${bareFrom}`);
    }

    if (otherPersonUuid !== undefined && doMarkDisplayed) {
      await markDisplayed(message);
    }

    if (callback !== undefined) {
      callback(message);
    }

  };

  return listen(EV_CHAT_WS_RECEIVE, _onReceiveMessage);
};

const fetchConversation = async (
  withPersonUuid: string,
  beforeId: string = '',
): Promise<ChatMessage[] | 'timeout'> => {
  const queryId = getRandomString(10);

  const data = {
    iq: {
      '@type': 'set',
      '@id': queryId,
      query: {
        '@xmlns': 'urn:xmpp:mam:2',
        '@queryid': queryId,
        x: {
          '@xmlns': 'jabber:x:data',
          '@type': 'submit',
          field: [
            { '@var': 'FORM_TYPE', value: 'urn:xmpp:mam:2' },
            { '@var': 'with', value: personUuidToJid(withPersonUuid) },
          ]
        },
        set: {
          '@xmlns': 'http://jabber.org/protocol/rsm',
          'max': '50',
          'before': beforeId
        }
      }
    }
  };

  const responseDetector = (doc: any): ChatMessage | null => { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const {
        message: {
          result: {
            '@queryid': receivedQueryId,
            '@id': mamId,
            forwarded: {
              delay: {
                '@stamp': timestamp,
              },
              message: {
                '@id': id,
                '@from': from,
                '@to': to,
                '@audio_uuid': audioUuid,
                '@reaction': reaction,
                '@reaction_from': reactionFrom,
                'body': text,
              }
            }
          }
        }
      } = doc;

      assert(receivedQueryId === queryId);

      ingestMamReaction(mamId, reaction, reactionFrom);

      if (audioUuid) {
        return {
          type: 'chat-audio',
          audioUuid: audioUuid,
          from: from,
          to: to,
          id: id,
          mamId: mamId || undefined,
          timestamp: new Date(timestamp),
          fromCurrentUser: jidMatchesSignedInUser(from),
        };
      } else {
        return {
          type: 'chat-text',
          text: text,
          from: from,
          to: to,
          id: id,
          mamId: mamId || undefined,
          timestamp: new Date(timestamp),
          fromCurrentUser: jidMatchesSignedInUser(from),
        };
      }
    } catch {
      return null;
    }
  };

  const sentinelDetector = (doc: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!credentials) {
      return false;
    }

    const expectedDoc = {
      iq: {
        "@xmlns": "jabber:client",
        "@from": `${credentials.username}@duolicious.app`,
        "@to": `${credentials.username}@duolicious.app`,
        "@id": queryId,
        "@type": "result",
        fin: {
          "@xmlns": "urn:xmpp:mam:2"
        }
      }
    }

    return _.isEqual(doc, expectedDoc);
  };

  // Release any snapshot queries held back in this conversation's favour (see
  // `frontend/chat/conversation-priority`). Kept in the same synchronous block
  // as the `send` below - the released waiters only resume as microtasks, so
  // this query is guaranteed onto the wire before theirs.
  markConversationFetchDispatched(withPersonUuid);

  const response = await send({
    data,
    responseDetector,
    sentinelDetector,
    timeoutMs: fetchConversationTimeout,
  });

  if (response !== 'timeout' && response.length > 0) {
    const lastMessage = response[response.length - 1];
    await markDisplayed(lastMessage);
  }

  // Reconcile whether our message is the conversation's last one against the
  // archive, but only on the first (most recent) page — older pages fetched
  // while scrolling up don't change what's at the bottom.
  if (response !== 'timeout' && beforeId === '') {
    const lastMessage = response[response.length - 1];
    notifyOwnLastMessageAt(
      withPersonUuid,
      lastMessage?.fromCurrentUser ? lastMessage.timestamp : null,
    );
  }

  return response;
};

const refreshInbox = async (): Promise<void> => {
  // An open conversation's history loads first (see
  // `frontend/chat/conversation-priority`); resolves immediately outside of
  // connect time.
  await awaitFocusedConversationFetch();

  const data = { duo_query_inbox: null };

  const responseDetector = (doc: any): Conversation[] | null => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (doc?.duo_inbox === undefined) {
      return null;
    }

    try {
      const parsed = doc.duo_inbox;

      if (!Array.isArray(parsed?.conversations)) {
        return null;
      }

      return parsed.conversations
        .map(conversationFromWire)
        .filter((c: Conversation | null): c is Conversation => c !== null);
    } catch {
      return null;
    }
  };

  const response = await send({
    data,
    responseDetector,
    timeoutMs: fetchInboxTimeout,
  });

  if (response === 'timeout') {
    return;
  }

  notify<Inbox>('inbox', conversationsToInbox(response));
};

const registerPushToken = async (token: string | null) => {
  const data = token ?
    { duo_register_push_token: { '@token': token } } :
    { duo_register_push_token: null };

  const responseDetector = (doc: any): true | null => { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (_.isEqual(doc, { duo_registration_successful: null })) {
      return true;
    } else {
      return null;
    }
  };

  // Retry once then give up
  const doTry = async () => send({ data, responseDetector });
  if (await doTry() === 'timeout') {
    await doTry();
  }
};

// Emit message events upon receiving a message
onReceiveMessage();

// Update the inbox upon receiving a conversation pushed by the server
listen(EV_CHAT_WS_RECEIVE, onReceiveInboxEntry);

const onWebsocketOpen = () => {
  notify('chat-is-websocket-open', true);
  authenticate();
};

const onWebsocketClose = () => {
  notify('chat-is-websocket-open', false);
  notify('chat-is-online', false);
};

listen(EV_CHAT_WS_OPEN, onWebsocketOpen);
listen(EV_CHAT_WS_CLOSE, onWebsocketClose);

export {
  Conversation,
  Conversations,
  Inbox,
  Message,
  ChatMessage,
  TypingMessage,
  MessageStatus,
  fetchConversation,
  inboxStats,
  login,
  logout,
  markDisplayed,
  onReceiveMessage,
  refreshInbox,
  registerPushToken,
  sendMessage,
  setConversationArchived,
  getInbox,
};
