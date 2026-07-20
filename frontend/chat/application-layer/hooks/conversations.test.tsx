import { jest } from '@jest/globals';

// `./conversations` transitively imports `../index`, whose imports have side
// effects that don't survive in the jest environment: `../../websocket-layer`
// opens a real websocket at import time (and reconnects forever, outliving
// the test), and `../../../notifications/notifications` pulls in
// expo-notifications. Neither is exercised here, so stub them out.
jest.mock('../../websocket-layer', () => ({
  EV_CHAT_WS_CLOSE: 'chat-ws-close',
  EV_CHAT_WS_OPEN: 'chat-ws-open',
  EV_CHAT_WS_RECEIVE: 'chat-ws-receive',
  EV_CHAT_WS_SEND_CLOSE: 'chat-ws-send-close',
  send: jest.fn(),
}));

jest.mock('../../../notifications/notifications', () => ({
  getAndRegisterPushToken: jest.fn(),
}));

import {
  computeConversationIds,
  sortConversations,
} from './conversations';
import { Conversation, Inbox } from '../index';

const conversation = (
  personUuid: string,
  matchPercentage: number,
  lastMessageTimestamp: Date,
  matchesSearchFilters: boolean,
): Conversation => ({
  personUuid,
  urlSlug: null,
  name: personUuid,
  matchPercentage,
  photoUuid: null,
  photoBlurhash: null,
  lastMessage: 'hi',
  lastMessageRead: false,
  lastMessageTimestamp,
  isAvailableUser: true,
  isVerified: false,
  location: 'intros',
  matchesSearchFilters,
});

// Names encode the sort keys so the expected orderings below are readable:
// match percentage, recency, and whether the sender matches search filters.
const match90old      = conversation('match90old',      90, new Date(1000), true);
const match50new      = conversation('match50new',      50, new Date(3000), true);
const match99filtered = conversation('match99filtered', 99, new Date(2000), false);
const match10filtered = conversation('match10filtered', 10, new Date(4000), false);

const intros = [match90old, match50new, match99filtered, match10filtered];

const ids = (cs: Conversation[]) => cs.map((c) => c.personUuid);

const inboxOf = (intros: Conversation[]): Inbox => ({
  chats: { conversations: [], conversationsMap: {} },
  intros: {
    conversations: intros,
    conversationsMap: Object.fromEntries(intros.map((c) => [c.personUuid, c])),
  },
  archive: { conversations: [], conversationsMap: {} },
  endTimestamp: null,
});

describe('sortConversations', () => {
  it('ignores search filters when not applying them', () => {
    expect(ids(sortConversations(intros, 'intros', 'match', false))).toEqual(
      ['match99filtered', 'match90old', 'match50new', 'match10filtered']);

    expect(ids(sortConversations(intros, 'intros', 'latest', false))).toEqual(
      ['match10filtered', 'match50new', 'match99filtered', 'match90old']);
  });

  it('sinks intros from outside search filters when applying them', () => {
    expect(ids(sortConversations(intros, 'intros', 'match', true))).toEqual(
      ['match90old', 'match50new', 'match99filtered', 'match10filtered']);

    expect(ids(sortConversations(intros, 'intros', 'latest', true))).toEqual(
      ['match50new', 'match90old', 'match10filtered', 'match99filtered']);
  });

  it('never sinks chats or archived conversations', () => {
    expect(ids(sortConversations(intros, 'chats', 'latest', true))).toEqual(
      ids(sortConversations(intros, 'chats', 'latest', false)));

    expect(ids(sortConversations(intros, 'archive', 'latest', true))).toEqual(
      ids(sortConversations(intros, 'archive', 'latest', false)));
  });
});

describe('computeConversationIds', () => {
  it('splits the list exactly where the sunk intros begin', () => {
    const computed = computeConversationIds(
      inboxOf(intros), 'intros', 'match', true);

    expect(computed?.numIntrosWithinFilters).toBe(2);
    expect(computed?.ids.slice(2)).toEqual(
      ['match99filtered', 'match10filtered']);
  });

  it('splits a section holding a single intro', () => {
    const computed = computeConversationIds(
      inboxOf([match99filtered]), 'intros', 'match', true);

    expect(computed?.numIntrosWithinFilters).toBe(0);
  });

  it('reports no split when the intros aren\'t sunk', () => {
    const noSplit = [
      // Filters not applied
      computeConversationIds(inboxOf(intros), 'intros', 'match', false),
      // No intros to triage
      computeConversationIds(inboxOf([]), 'intros', 'match', true),
      // Not the intros section
      computeConversationIds(inboxOf(intros), 'chats', 'latest', true),
    ];

    noSplit.forEach((computed) =>
      expect(computed?.numIntrosWithinFilters).toBeNull());
  });
});
