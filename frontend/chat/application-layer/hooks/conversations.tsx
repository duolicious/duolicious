import { useCallback, useEffect, useState } from 'react';
import { compareArrays } from '../../../util/util';
import { Inbox, Conversation, getInbox } from '../index';
import { listen } from '../../../events/events';
import * as _ from 'lodash';


const MIN_INTROS_TO_APPLY_SEARCH_FILTERS = 10;

// Intros sections smaller than the minimum aren't worth triaging, so applying
// search filters only reorders (and divides) sections at least that big.
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

type ConversationsState = {
  conversations: string[] | null
  numIntrosWithinFilters: number | null
  sectionIndex: number
  sortByIndex: number
  showArchive: boolean
  applySearchFilters: boolean
};

// The settings with the conversation list (and its search-filter boundary)
// re-derived from the given inbox. Every state transition goes through here
// so the derived fields always describe the settings they sit beside.
const withComputedConversations = (
  state: ConversationsState,
  inbox: Inbox | null,
): ConversationsState => {
  const section = getSection(state.sectionIndex, state.showArchive);
  const sortBy = getSortBy(state.sortByIndex);

  const computed = computeConversationIds(
    inbox, section, sortBy, state.applySearchFilters);

  return {
    ...state,
    conversations: computed === null ? null : computed.ids,
    numIntrosWithinFilters:
      computed === null ? null : computed.numIntrosWithinFilters,
  };
};

const useConversations = () => {
  const [state, setState] = useState<ConversationsState>({
    conversations: null,
    numIntrosWithinFilters: null,
    sectionIndex: 0,
    sortByIndex: 0,
    showArchive: false,
    applySearchFilters: false,
  });

  // Subscribe to inbox updates and update only when the derived list changes.
  useEffect(() => {
    const onUpdate = (newInbox?: Inbox | null) => {
      setState((oldState) => {
        const newState = withComputedConversations(oldState, newInbox ?? null);

        const unchanged =
          _.isEqual(oldState.conversations, newState.conversations) &&
          oldState.numIntrosWithinFilters === newState.numIntrosWithinFilters;

        return unchanged ? oldState : newState;
      });
    };

    return listen<Inbox | null>('inbox', onUpdate, true);
  }, []);

  const setSectionIndex = useCallback((sectionIndex: number) => {
    setState((oldState) =>
      oldState.sectionIndex === sectionIndex
        ? oldState
        : withComputedConversations({ ...oldState, sectionIndex }, getInbox())
    );
  }, []);

  const setSortByIndex = useCallback((sortByIndex: number) => {
    setState((oldState) =>
      oldState.sortByIndex === sortByIndex
        ? oldState
        : withComputedConversations({ ...oldState, sortByIndex }, getInbox())
    );
  }, []);

  const setApplySearchFilters = useCallback((applySearchFilters: boolean) => {
    setState((oldState) =>
      oldState.applySearchFilters === applySearchFilters
        ? oldState
        : withComputedConversations(
            { ...oldState, applySearchFilters }, getInbox())
    );
  }, []);

  const setShowArchive = useCallback((f: (showArchive: boolean) => boolean) => {
    setState((oldState) => {
      const showArchive = f(oldState.showArchive);

      return oldState.showArchive === showArchive
        ? oldState
        : withComputedConversations({ ...oldState, showArchive }, getInbox());
    });
  }, []);

  return {
    ...state,
    setSectionIndex,
    setSortByIndex,
    setApplySearchFilters,
    setShowArchive,
  }
};

export {
  MIN_INTROS_TO_APPLY_SEARCH_FILTERS,
  computeConversationIds,
  sortConversations,
  useConversations,
};
