import { useLayoutEffect, useState } from 'react';
import * as _ from 'lodash';
import { listen, notify, lastEvent, useDerivedEvent } from './events';
import { markSearchResultsStale } from './stale-search-results';
import { markInboxStale } from './stale-inbox';
import { markFeedStale } from './stale-feed';
import { japi } from '../api/api';
import { searchQueue } from '../api/queue';
import { notifyErrorToast } from '../components/toast';

const MAX_SEARCH_FILTER_ANSWERS = 20;

type SearchFilterAnswer = {
  question_id: number;
  question: string;
  topic: string;
  answer: boolean | null;
  accept_unanswered: boolean;
};

type SearchFilters = {
  answer?: SearchFilterAnswer[];
  [key: string]: unknown;
};

const EVENT_KEY = 'search-filters';
const SEARCHED_EVENT_KEY = 'searched-search-filters';

const getSearchFilters = (): SearchFilters | undefined => {
  return lastEvent<SearchFilters | undefined>(EVENT_KEY);
};

const setSearchFilters = (next: SearchFilters | undefined) => {
  notify<SearchFilters | undefined>(EVENT_KEY, next);
  if (next && !lastEvent<SearchFilters>(SEARCHED_EVENT_KEY)) {
    notify<SearchFilters>(SEARCHED_EVENT_KEY, next);
  }
};

const recordSearchedFilters = (filters: SearchFilters | undefined) => {
  if (!filters) return;
  notify<SearchFilters>(SEARCHED_EVENT_KEY, filters);
};

const filterValueChanged = (next: unknown, prev: unknown): boolean => {
  if (Array.isArray(next) && Array.isArray(prev)) {
    return _.xorWith(next, prev, _.isEqual).length > 0;
  }
  return !_.isEqual(next, prev);
};

const patchSearchFilters = (partial: SearchFilters) => {
  const prev = getSearchFilters();
  if (!prev) return;

  const changed = Object.keys(partial).some(
    (key) => filterValueChanged(partial[key], prev[key]));
  if (!changed) return;

  markSearchResultsStale();
  markInboxStale();
  if ('gender' in partial || 'age' in partial) {
    markFeedStale();
  }
  notify<SearchFilters>(EVENT_KEY, { ...prev, ...partial });
};

let lastSearchFilterWrite: Promise<unknown> | null = null;

const sendTwoWayFilters = _.debounce((value: Record<string, boolean>) => {
  lastSearchFilterWrite = searchQueue.addTask(async () => {
    const ok = (await japi(
      'post',
      '/search-filter',
      { two_way_filters: value },
    )).ok;
    if (ok) {
      markSearchResultsStale();
      markInboxStale();
    }
    return ok;
  });
}, 1000);

const setTwoWayFilter = (key: string, value: boolean) => {
  const prev = getSearchFilters();
  if (!prev) return;

  const prevTwoWay = (prev.two_way_filters ?? {}) as Record<string, boolean>;
  const next = { ...prevTwoWay, [key]: value };

  notify<SearchFilters>(EVENT_KEY, { ...prev, two_way_filters: next });
  sendTwoWayFilters(next);
};

const pendingAnswerWrites = new Map<number, SearchFilterAnswer>();

const sendSearchFilterAnswers = _.debounce(() => {
  const writes = [...pendingAnswerWrites.values()];
  pendingAnswerWrites.clear();

  lastSearchFilterWrite = searchQueue.addTask(async () => {
    for (const { question_id, answer, accept_unanswered } of writes) {
      await japi(
        'post',
        '/search-filter-answer',
        { question_id, answer, accept_unanswered },
      );
    }
    markSearchResultsStale();
    markInboxStale();
  });
}, 1000);

const setSearchFilterAnswer = (next: SearchFilterAnswer) => {
  const prev = getSearchFilters();
  if (!prev) return;

  const prevAnswers = prev.answer ?? [];
  const others = prevAnswers.filter((a) => a.question_id !== next.question_id);

  if (next.answer === null && others.length === prevAnswers.length) return;

  if (next.answer !== null && others.length >= MAX_SEARCH_FILTER_ANSWERS) {
    notifyErrorToast(
      `You can’t set more than ${MAX_SEARCH_FILTER_ANSWERS} Q&A filters`);
    return;
  }

  notify<SearchFilters>(EVENT_KEY, {
    ...prev,
    answer: next.answer === null ?
      others :
      _.sortBy([...others, next], 'question_id'),
  });
  pendingAnswerWrites.set(next.question_id, next);
  sendSearchFilterAnswers();
};

const flushSearchFilterWrites = async (): Promise<void> => {
  sendTwoWayFilters.flush();
  sendSearchFilterAnswers.flush();
  await lastSearchFilterWrite;
};

const resetSearchFilters = () => {
  sendTwoWayFilters.cancel();
  sendSearchFilterAnswers.cancel();
  pendingAnswerWrites.clear();
  notify<SearchFilters | undefined>(EVENT_KEY, undefined);
  notify<SearchFilters | undefined>(SEARCHED_EVENT_KEY, undefined);
};

const useSearchFilters = () => {
  const [value, setValue] = useState<SearchFilters | undefined>(
    getSearchFilters());

  useLayoutEffect(() => {
    return listen<SearchFilters | undefined>(EVENT_KEY, setValue, true);
  }, []);

  return value;
};

const useHasUnsearchedChanges = (): boolean => {
  const filters = useSearchFilters();
  const searched = useDerivedEvent<SearchFilters, SearchFilters | undefined>(
    SEARCHED_EVENT_KEY, (x) => x, []);

  return !!filters && !!searched &&
    _.union(Object.keys(filters), Object.keys(searched)).some(
      (key) => filterValueChanged(filters[key], searched[key]));
};

export {
  SearchFilterAnswer,
  SearchFilters,
  flushSearchFilterWrites,
  getSearchFilters,
  patchSearchFilters,
  recordSearchedFilters,
  resetSearchFilters,
  setSearchFilterAnswer,
  setSearchFilters,
  setTwoWayFilter,
  useHasUnsearchedChanges,
  useSearchFilters,
};
