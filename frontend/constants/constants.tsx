const ONLINE_COLOR = '#23a55a';

const ONLINE_RECENTLY_COLOR = '#a5ffce';

// How long a sighting keeps the 'online-recently' indicator visible. Loosely
// coordinated with the backend's ONLINE_PRESENCE_TTL_SECONDS, which caps how
// old a reported sighting can be.
const ONLINE_RECENTLY_WINDOW_MS = 24 * 60 * 60 * 1000;

const COLUMN_MAX_WIDTH = 600;

export {
  COLUMN_MAX_WIDTH,
  ONLINE_COLOR,
  ONLINE_RECENTLY_COLOR,
  ONLINE_RECENTLY_WINDOW_MS,
};
