import { storeKv } from './kv-storage';

const inboxNumber = async (
  key: 'inbox_section' | 'inbox_apply_search_filters',
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

const INBOX_ORDERS = ['intro', 'match', 'latest'] as const;

type InboxOrder = typeof INBOX_ORDERS[number];

const inboxOrder = async (value?: InboxOrder): Promise<InboxOrder | null> => {
  const loaded = await storeKv('inbox_order', value);

  if (loaded === '1') {
    return 'latest';
  }

  return INBOX_ORDERS.find((order) => order === loaded) ?? null;
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
  InboxOrder,
  inboxApplySearchFilters,
  inboxOrder,
  inboxSection,
}
