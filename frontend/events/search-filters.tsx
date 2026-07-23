import { useLayoutEffect, useState } from 'react';
import * as _ from 'lodash';
import { listen, notify, lastEvent } from './events';
import { markSearchResultsStale } from './stale-search-results';
import { markInboxStale } from './stale-inbox';
import { markFeedStale } from './stale-feed';
import { japi } from '../api/api';
import { searchQueue } from '../api/queue';
import type { SearchFilterAnswer } from '../navigation/search-filter-state';

type SearchFilters = {
  answer?: SearchFilterAnswer[];
  [key: string]: unknown;
};

const EVENT_KEY = 'search-filters';

const getSearchFilters = (): SearchFilters | undefined => {
  return lastEvent<SearchFilters | undefined>(EVENT_KEY);
};

const setSearchFilters = (next: SearchFilters | undefined) => {
  notify<SearchFilters | undefined>(EVENT_KEY, next);
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

const resetSearchFilters = () => {
  notify<SearchFilters | undefined>(EVENT_KEY, undefined);
};

let pendingTwoWayFilterWrite: Promise<unknown> | null = null;

const sendTwoWayFilters = _.debounce((value: Record<string, boolean>) => {
  pendingTwoWayFilterWrite = searchQueue.addTask(async () => {
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

const flushSearchFilterWrites = async (): Promise<void> => {
  sendTwoWayFilters.flush();
  await pendingTwoWayFilterWrite;
};

const useSearchFilters = () => {
  const [value, setValue] = useState<SearchFilters | undefined>(
    getSearchFilters());

  useLayoutEffect(() => {
    return listen<SearchFilters | undefined>(EVENT_KEY, setValue, true);
  }, []);

  return value;
};

export {
  SearchFilters,
  flushSearchFilterWrites,
  getSearchFilters,
  patchSearchFilters,
  resetSearchFilters,
  setSearchFilters,
  setTwoWayFilter,
  useSearchFilters,
};
