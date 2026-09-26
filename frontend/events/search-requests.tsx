import { lastEvent, listen, notify, useDerivedEvent } from './events';

const REQUEST_KEY = 'search-requested';
const IS_SEARCHING_KEY = 'is-searching';

const requestSearch = () => notify(REQUEST_KEY);

const whileSearching = async (search: () => Promise<void>) => {
  notify(IS_SEARCHING_KEY, true);
  try {
    await search();
  } finally {
    notify(IS_SEARCHING_KEY, false);
  }
};

const listenSearchRequests = (search: () => Promise<void>) =>
  listen(REQUEST_KEY, () => {
    if (lastEvent<boolean>(IS_SEARCHING_KEY)) return;
    whileSearching(search);
  });

const useIsSearching = () =>
  useDerivedEvent<boolean, boolean>(IS_SEARCHING_KEY, (x) => x ?? false, []);

export {
  listenSearchRequests,
  requestSearch,
  useIsSearching,
  whileSearching,
};
