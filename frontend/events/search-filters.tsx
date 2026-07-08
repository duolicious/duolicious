import { useLayoutEffect, useState } from 'react';
import * as _ from 'lodash';
import { listen, notify, lastEvent } from './events';
import { markSearchResultsStale } from './stale-search-results';
import { markInboxStale } from './stale-inbox';
import { markFeedStale } from './stale-feed';
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
  getSearchFilters,
  patchSearchFilters,
  resetSearchFilters,
  setSearchFilters,
  useSearchFilters,
};
