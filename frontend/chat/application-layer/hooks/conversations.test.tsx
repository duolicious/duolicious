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
  awaitingReply = false,
  hidden = false,
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
  hidden,
  awaitingReply,
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

const repliedOld    = conversation('repliedOld',    90, new Date(1000), true);
const unrepliedNew  = conversation('unrepliedNew',  50, new Date(4000), true, true);
const repliedNew    = conversation('repliedNew',    10, new Date(3000), true);
const unrepliedOld  = conversation('unrepliedOld',  99, new Date(2000), true, true);

const chats = [repliedOld, unrepliedNew, repliedNew, unrepliedOld];

const conversationsOf = (cs: Conversation[]) => ({
  conversations: cs,
  conversationsMap: Object.fromEntries(cs.map((c) => [c.personUuid, c])),
});

const inboxOf = (intros: Conversation[], chats: Conversation[] = []): Inbox => ({
  chats: conversationsOf(chats),
  intros: conversationsOf(intros),
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

  it('never sinks chats or archived conversations by search filters', () => {
    expect(ids(sortConversations(intros, 'chats', 'latest', true))).toEqual(
      ids(sortConversations(intros, 'chats', 'latest', false)));

    expect(ids(sortConversations(intros, 'archive', 'latest', true))).toEqual(
      ids(sortConversations(intros, 'archive', 'latest', false)));
  });

  it('sinks chats waiting for a reply, latest first within each group', () => {
    expect(ids(sortConversations(chats, 'chats', 'match', false))).toEqual(
      ['repliedNew', 'repliedOld', 'unrepliedNew', 'unrepliedOld']);
  });
});

describe('computeConversationIds', () => {
  it('splits the list exactly where the sunk intros begin', () => {
    const computed = computeConversationIds(
      inboxOf(intros), 'intros', 'match', true);

    expect(computed?.numAboveDivider).toBe(2);
    expect(computed?.ids.slice(2)).toEqual(
      ['match99filtered', 'match10filtered']);
  });

  it('splits a section holding a single intro', () => {
    const computed = computeConversationIds(
      inboxOf([match99filtered]), 'intros', 'match', true);

    expect(computed?.numAboveDivider).toBe(0);
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
      expect(computed?.numAboveDivider).toBeNull());
  });

  it('splits chats only when some have replies and some are waiting', () => {
    expect(computeConversationIds(
      inboxOf([], chats), 'chats', 'latest', false)?.numAboveDivider).toBe(2);

    expect(computeConversationIds(
      inboxOf([], [repliedOld, repliedNew]), 'chats', 'latest', false,
    )?.numAboveDivider).toBeNull();

    expect(computeConversationIds(
      inboxOf([], [unrepliedOld, unrepliedNew]), 'chats', 'latest', false,
    )?.numAboveDivider).toBeNull();
  });
});

describe('hidden intros', () => {
  const hiddenOld = conversation('hiddenOld', 99, new Date(1500), true, false, true);
  const hiddenNew = conversation('hiddenNew', 10, new Date(5000), true, false, true);

  const inbox = inboxOf([...intros, hiddenOld, hiddenNew]);

  it('leaves hidden intros out of the intros section', () => {
    expect(computeConversationIds(inbox, 'intros', 'match', false)?.ids)
      .toEqual(['match99filtered', 'match90old', 'match50new', 'match10filtered']);
  });

  it('lists only hidden intros in the hidden section, newest first', () => {
    const computed = computeConversationIds(inbox, 'hidden', 'match', true);

    expect(computed?.ids).toEqual(['hiddenNew', 'hiddenOld']);
    expect(computed?.numAboveDivider).toBeNull();
  });
});
