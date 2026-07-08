import { storeKv } from './kv-storage';

const inboxNumber = async (
  key: 'inbox_order' | 'inbox_section' | 'inbox_apply_search_filters',
  value?: number
) => {
  const loaded = await storeKv(
    key,
    value === undefined ? undefined : String(value));

  if (loaded === undefined || loaded === null) {
    return 0;
  }

  const loadedInt = parseInt(loaded);

  if (isNaN(loadedInt)) {
    return 0;
  }

  return loadedInt;
};

const inboxOrder = async (value?: number) => {
  return await inboxNumber('inbox_order', value);
};

const inboxSection = async (value?: number) => {
  return await inboxNumber('inbox_section', value);
};

// Whether intros from outside the user's search filters get sorted last and
// flagged. Off (0) by default.
const inboxApplySearchFilters = async (value?: number) => {
  return await inboxNumber('inbox_apply_search_filters', value);
};

export {
  inboxApplySearchFilters,
  inboxOrder,
  inboxSection,
}
