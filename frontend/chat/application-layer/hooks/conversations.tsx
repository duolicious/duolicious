import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { compareArrays } from '../../../util/util';
import { Inbox, Conversation, getInbox } from '../index';
import {
  lastEvent,
  listen,
  notify,
  useDerivedEvent,
} from '../../../events/events';
import { getSignedInUser } from '../../../events/signed-in-user';
import {
  InboxOrder,
  inboxApplySearchFilters,
  inboxOrder,
  inboxSection,
} from '../../../kv-storage/inbox';
import * as _ from 'lodash';


const MIN_INTROS_TO_APPLY_SEARCH_FILTERS = 1;

type Section = 'intros' | 'chats' | 'archive' | 'hidden';

const shouldApplySearchFilters = (
  conversations: Conversation[],
  section: Section,
  applySearchFilters: boolean,
): boolean =>
  section === 'intros' &&
  applySearchFilters &&
  conversations.length >= MIN_INTROS_TO_APPLY_SEARCH_FILTERS;

const getSection = (
  sectionIndex: number,
  showArchive: boolean,
  showHidden: boolean,
): Section => {
  if (showArchive) {
    return 'archive';
  } else if (showHidden) {
    return 'hidden';
  } else if (sectionIndex === 0) {
    return 'intros';
  } else {
    return 'chats';
  }
};

const LAST_PERSON_ID_BEFORE_INTRO_TEST = 402440;

const getSortOrders = (): InboxOrder[] => {
  const personId = getSignedInUser()?.personId ?? 1;

  return (
    Platform.OS === 'web' &&
    personId > LAST_PERSON_ID_BEFORE_INTRO_TEST &&
    personId % 2 === 0
  )
    ? ['intro', 'match', 'latest']
    : ['match', 'latest'];
};

/**
 * React hook that returns the list of `personUuid`s for the conversations
 * that belong to the requested inbox section. The list is memoised so that
 * the reference will only change when the ordering or membership actually
 * changes – this helps to minimise re-renders of parent components that pass
 * the list directly to a `FlatList`.
 *
 * @param section   Which sub-section of the inbox to return ("intros",
 *                  "chats" or "archive").
 * @param sortBy    Sorting preference index; mirrors the logic from the
 *                  original implementation in `components/inbox-tab.tsx`.
 */
const getSectionConversations = (
  inbox: Inbox | null,
  section: Section,
): Conversation[] => {
  if (!inbox) return [];

  switch (section) {
    case 'intros':  return inbox.intros.conversations.filter((c) => !c.hidden);
    case 'chats':   return inbox.chats.conversations;
    case 'archive': return inbox.archive.conversations;
    case 'hidden':  return inbox.intros.conversations.filter((c) => c.hidden);
    default:        return [];
  }
};

const sortConversations = (
  conversations: Conversation[],
  section: Section,
  sortBy: InboxOrder,
  applySearchFilters: boolean,
): Conversation[] => {
  if (conversations.length === 0) return conversations;

  const applySearchFilters_ =
    shouldApplySearchFilters(conversations, section, applySearchFilters);

  // When the user applies their search filters to intros, intros from outside
  // the filters sink below the rest, keeping their relative order otherwise.
  const filterRank = (c: Conversation) =>
    applySearchFilters_ && !c.matchesSearchFilters
      ? 0
      : 1;

  return [...conversations].sort((a, b) => {
    if (section === 'archive' || section === 'hidden') {
      return compareArrays([
        +b.lastMessageTimestamp,
      ], [
        +a.lastMessageTimestamp,
      ]);
    } else if (section === 'intros' && sortBy === 'intro') {
      return compareArrays(
        [filterRank(b), b.introScore ?? -1, b.matchPercentage, +b.lastMessageTimestamp],
        [filterRank(a), a.introScore ?? -1, a.matchPercentage, +a.lastMessageTimestamp],
      );
    } else if (section === 'intros' && sortBy === 'match') {
      return compareArrays(
        [filterRank(b), b.matchPercentage, +b.lastMessageTimestamp],
        [filterRank(a), a.matchPercentage, +a.lastMessageTimestamp],
      );
    } else {
      return compareArrays(
        [filterRank(b), +b.lastMessageTimestamp, b.matchPercentage],
        [filterRank(a), +a.lastMessageTimestamp, a.matchPercentage],
      );
    }
  });
};

type ConversationIds = {
  ids: string[]
  numIntrosWithinFilters: number | null
};

const computeConversationIds = (
  inbox: Inbox | null,
  section: Section,
  sortBy: InboxOrder,
  applySearchFilters: boolean,
): ConversationIds | null => {
  if (inbox === null) {
    return null;
  }

  const conversations = getSectionConversations(inbox, section);
  const sorted = sortConversations(
    conversations, section, sortBy, applySearchFilters);

  // The sort sank every intro from outside the filters below those within
  // them, so the count of intros within is also the boundary's index.
  const numIntrosWithinFilters =
    shouldApplySearchFilters(sorted, section, applySearchFilters)
      ? sorted.filter((c) => c.matchesSearchFilters).length
      : null;

  return {
    ids: sorted.map((c) => c.personUuid),
    numIntrosWithinFilters,
  };
};

type InboxSettings = {
  sectionIndex: number
  sortBy: InboxOrder | null
  showArchive: boolean
  showHidden: boolean
  applySearchFilters: boolean
};

const EV_INBOX_SETTINGS = 'inbox-settings';

const defaultInboxSettings: InboxSettings = {
  sectionIndex: 0,
  sortBy: null,
  showArchive: false,
  showHidden: false,
  applySearchFilters: false,
};

const getInboxSettings = (): InboxSettings =>
  lastEvent<InboxSettings>(EV_INBOX_SETTINGS) ?? defaultInboxSettings;

const updateInboxSettings = (patch: Partial<InboxSettings>) =>
  notify<InboxSettings>(EV_INBOX_SETTINGS, { ...getInboxSettings(), ...patch });

let hasLoadedInboxSettings = false;

const loadInboxSettings = async () => {
  if (hasLoadedInboxSettings) return;
  hasLoadedInboxSettings = true;

  const [sortBy, sectionIndex, applySearchFilters] = await Promise.all([
    inboxOrder(),
    inboxSection(),
    inboxApplySearchFilters(),
  ]);

  updateInboxSettings({
    sortBy,
    sectionIndex,
    applySearchFilters: !!applySearchFilters,
  });
};

const resetInboxSettings = () => {
  hasLoadedInboxSettings = false;
  notify<InboxSettings>(EV_INBOX_SETTINGS, defaultInboxSettings);
};

const setInboxSettings = (patch: Partial<InboxSettings>) => {
  updateInboxSettings(patch);
  if (patch.sectionIndex !== undefined) inboxSection(patch.sectionIndex);
  if (patch.sortBy) inboxOrder(patch.sortBy);
  if (patch.applySearchFilters !== undefined) {
    inboxApplySearchFilters(patch.applySearchFilters ? 1 : 0);
  }
};

const useInboxSettings = (): InboxSettings => {
  useEffect(() => { loadInboxSettings(); }, []);

  return useDerivedEvent(EV_INBOX_SETTINGS, getInboxSettings, []);
};

type ConversationsState = InboxSettings & {
  sortOrders: InboxOrder[]
  sortByIndex: number
  conversations: string[] | null
  numIntrosWithinFilters: number | null
  numHidden: number
};

const withComputedConversations = (
  settings: InboxSettings,
  inbox: Inbox | null,
): ConversationsState => {
  const section = getSection(
    settings.sectionIndex, settings.showArchive, settings.showHidden);
  const sortOrders = getSortOrders();
  const sortByIndex = Math.max(
    0, sortOrders.findIndex((order) => order === settings.sortBy));

  const computed = computeConversationIds(
    inbox, section, sortOrders[sortByIndex], settings.applySearchFilters);

  return {
    ...settings,
    sortOrders,
    sortByIndex,
    conversations: computed?.ids ?? null,
    numIntrosWithinFilters: computed?.numIntrosWithinFilters ?? null,
    numHidden: getSectionConversations(inbox, 'hidden').length,
  };
};

const useConversations = (): ConversationsState => {
  const settings = useInboxSettings();

  const [state, setState] = useState(
    () => withComputedConversations(settings, getInbox()));

  useEffect(() => {
    const update = () => setState((oldState) => {
      const newState = withComputedConversations(settings, getInbox());

      return _.isEqual(oldState, newState) ? oldState : newState;
    });

    update();

    return listen<Inbox | null>('inbox', update);
  }, [settings]);

  return state;
};

export {
  MIN_INTROS_TO_APPLY_SEARCH_FILTERS,
  computeConversationIds,
  getSortOrders,
  resetInboxSettings,
  setInboxSettings,
  sortConversations,
  useConversations,
  useInboxSettings,
};
