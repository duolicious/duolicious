import { useCallback, useEffect, useState } from 'react';
import { compareArrays } from '../../../util/util';
import { Inbox, Conversation, getInbox } from '../index';
import { listen } from '../../../events/events';
import * as _ from 'lodash';


const MIN_INTROS_TO_APPLY_SEARCH_FILTERS = 10;

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
    applySearchFilters &&
    conversations.length >= MIN_INTROS_TO_APPLY_SEARCH_FILTERS;

  // When the user applies their search filters to intros, intros from outside
  // the filters sink below the rest, keeping their relative order otherwise.
  const filterRank = (c: Conversation) =>
    section === 'intros' && applySearchFilters_ && !c.matchesSearchFilters
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

const computeConversationIds = (
  inbox: Inbox | null,
  section: 'intros' | 'chats' | 'archive',
  sortBy: 'latest' | 'match',
  applySearchFilters: boolean,
): string[] | null => {
  if (inbox === null) {
    return null;
  }

  const conversations = getSectionConversations(inbox, section);
  const sorted = sortConversations(
    conversations, section, sortBy, applySearchFilters);
  return sorted.map((c) => c.personUuid);
};

const useConversations = () => {
  const [state, setState] = useState<{
    conversations: string[] | null,
    sectionIndex: number,
    sortByIndex: number,
    showArchive: boolean,
    applySearchFilters: boolean,
  }>({
    conversations: null,
    sectionIndex: 0,
    sortByIndex: 0,
    showArchive: false,
    applySearchFilters: false,
  });

  // Subscribe to inbox updates and update only when the derived list changes.
  useEffect(() => {
    const onUpdate = (newInbox?: Inbox | null) => {
      setState((oldState) => {
        const {
          sectionIndex,
          sortByIndex,
          showArchive,
          applySearchFilters,
        } = oldState;

        const section = getSection(sectionIndex, showArchive);
        const sortBy = getSortBy(sortByIndex);

        const newIds = computeConversationIds(
          newInbox ?? null, section, sortBy, applySearchFilters);

        return _.isEqual(oldState.conversations, newIds)
          ? oldState
          : { ...oldState, conversations: newIds }
      });
    };

    return listen<Inbox | null>('inbox', onUpdate, true);
  }, []);

  const setSectionIndex = useCallback((sectionIndex: number) => {
    setState((oldState) => {
      if (oldState.sectionIndex === sectionIndex) {
        return oldState;
      }

      const { sortByIndex, showArchive, applySearchFilters } = oldState;

      const section = getSection(sectionIndex, showArchive);
      const sortBy = getSortBy(sortByIndex);

      const inbox = getInbox();
      const conversations = computeConversationIds(
        inbox, section, sortBy, applySearchFilters);

      return { ...oldState, conversations, sectionIndex };
    });
  }, []);

  const setSortByIndex = useCallback((sortByIndex: number) => {
    setState((oldState) => {
      if (oldState.sortByIndex === sortByIndex) {
        return oldState;
      }

      const { sectionIndex, showArchive, applySearchFilters } = oldState;

      const section = getSection(sectionIndex, showArchive);
      const sortBy = getSortBy(sortByIndex);

      const inbox = getInbox();
      const conversations = computeConversationIds(
        inbox, section, sortBy, applySearchFilters);

      return { ...oldState, conversations, sortByIndex };
    });
  }, []);

  const setApplySearchFilters = useCallback((applySearchFilters: boolean) => {
    setState((oldState) => {
      if (oldState.applySearchFilters === applySearchFilters) {
        return oldState;
      }

      const { sectionIndex, sortByIndex, showArchive } = oldState;

      const section = getSection(sectionIndex, showArchive);
      const sortBy = getSortBy(sortByIndex);

      const inbox = getInbox();
      const conversations = computeConversationIds(
        inbox, section, sortBy, applySearchFilters);

      return { ...oldState, conversations, applySearchFilters };
    });
  }, []);

  const setShowArchive = useCallback((f: (showArchive: boolean) => boolean) => {
    setState((oldState) => {
      const showArchive = f(oldState.showArchive);

      if (oldState.showArchive === showArchive) {
        return oldState;
      }

      const { sectionIndex, sortByIndex, applySearchFilters } = oldState;

      const section = getSection(sectionIndex, showArchive);
      const sortBy = getSortBy(sortByIndex);

      const inbox = getInbox();
      const conversations = computeConversationIds(
        inbox, section, sortBy, applySearchFilters);

      return { ...oldState, conversations, showArchive };
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
  sortConversations,
  useConversations,
};
