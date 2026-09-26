import { storeKv } from '../kv-storage/kv-storage';
import { japi } from '../api/api';
import { patchSearchFilters, resetSearchFilters } from './search-filters';

type PublicSearchFilters = {
  gender?: string[]
  age?: { min_age: number | null, max_age: number | null }
};

let publicSearchFilters: PublicSearchFilters = {};

const loadPublicSearchFilters = async (): Promise<void> => {
  const raw = await storeKv('public_search_filters');
  try {
    publicSearchFilters = raw ? JSON.parse(raw) : {};
  } catch {
    publicSearchFilters = {};
  }
};

const getPublicSearchFilters = (): PublicSearchFilters => publicSearchFilters;

const setPublicSearchFilters = (partial: PublicSearchFilters): void => {
  publicSearchFilters = { ...publicSearchFilters, ...partial };
  storeKv('public_search_filters', JSON.stringify(publicSearchFilters));
  patchSearchFilters(partial);
};

const clearPublicSearchFilters = (): void => {
  publicSearchFilters = {};
  storeKv('public_search_filters', null);
  resetSearchFilters();
};

const savePublicSearchAge = async (): Promise<void> => {
  const { age } = publicSearchFilters;
  if (age) {
    await japi('post', '/search-filter', { age });
  }
};

export {
  clearPublicSearchFilters,
  getPublicSearchFilters,
  loadPublicSearchFilters,
  savePublicSearchAge,
  setPublicSearchFilters,
};
