import { useEffect, useState } from 'react';
import { compareArrays } from '../../../util/util';
import { Inbox, Conversation, getInbox } from '../index';
import {
  lastEvent,
  listen,
  notify,
  useDerivedEvent,
} from '../../../events/events';
import {
  inboxApplySearchFilters,
  inboxOrder,
  inboxSection,
} from '../../../kv-storage/inbox';
import * as _ from 'lodash';


const MIN_INTROS_TO_APPLY_SEARCH_FILTERS = 1;

const shouldApplySearchFilters = (
  conversations: Conversation[],
  section: 'intros' | 'chats' | 'archive',
  applySearchFilters: boolean,
): boolean =>
  section === 'intros' &&
  applySearchFilters &&
  conversations.length >= MIN_INTROS_TO_APPLY_SEARCH_FILTERS;

const getSection = (sectionIndex: number, showArchive: boolean) => {
  if (showArchive) {
    return 'archive';
  } else if (sectionIndex === 0) {
    return 'intros';
  } else {
    return 'chats';
  }
};

const getSortBy = (sortByIndex: number) => {
  if (sortByIndex === 0) {
    return 'match';
  } else {
    return 'latest'
  }
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
  section: 'intros' | 'chats' | 'archive',
): Conversation[] => {
  if (!inbox) return [];

  switch (section) {
    case 'intros':  return inbox.intros.conversations;
    case 'chats':   return inbox.chats.conversations;
    case 'archive': return inbox.archive.conversations;
    default:        return [];
  }
};

const sortConversations = (
  conversations: Conversation[],
  section: 'intros' | 'chats' | 'archive',
  sortBy: 'latest' | 'match',
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
    if (section === 'archive') {
      return compareArrays([
        +b.lastMessageTimestamp,
      ], [
        +a.lastMessageTimestamp,
      ]);
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
  section: 'intros' | 'chats' | 'archive',
  sortBy: 'latest' | 'match',
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
  sortByIndex: number
  showArchive: boolean
  applySearchFilters: boolean
};

const EV_INBOX_SETTINGS = 'inbox-settings';

const defaultInboxSettings: InboxSettings = {
  sectionIndex: 0,
  sortByIndex: 0,
  showArchive: false,
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

  const [sortByIndex, sectionIndex, applySearchFilters] = await Promise.all([
    inboxOrder(),
    inboxSection(),
    inboxApplySearchFilters(),
  ]);

  updateInboxSettings({
    sortByIndex,
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
  if (patch.sortByIndex !== undefined) inboxOrder(patch.sortByIndex);
  if (patch.applySearchFilters !== undefined) {
    inboxApplySearchFilters(patch.applySearchFilters ? 1 : 0);
  }
};

const useInboxSettings = (): InboxSettings => {
  useEffect(() => { loadInboxSettings(); }, []);

  return useDerivedEvent(EV_INBOX_SETTINGS, getInboxSettings, []);
};

type ConversationsState = InboxSettings & {
  conversations: string[] | null
  numIntrosWithinFilters: number | null
};

const withComputedConversations = (
  settings: InboxSettings,
  inbox: Inbox | null,
): ConversationsState => {
  const section = getSection(settings.sectionIndex, settings.showArchive);
  const sortBy = getSortBy(settings.sortByIndex);

  const computed = computeConversationIds(
    inbox, section, sortBy, settings.applySearchFilters);

  return {
    ...settings,
    conversations: computed?.ids ?? null,
    numIntrosWithinFilters: computed?.numIntrosWithinFilters ?? null,
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
  resetInboxSettings,
  setInboxSettings,
  sortConversations,
  useConversations,
  useInboxSettings,
};
