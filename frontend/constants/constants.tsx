const ONLINE_COLOR = '#23a55a';

const ONLINE_RECENTLY_COLOR = '#a5ffce';

// How long a sighting keeps the 'online-recently' indicator visible. Loosely
// coordinated with the backend's ONLINE_PRESENCE_TTL_SECONDS, which caps how
// old a reported sighting can be.
const ONLINE_RECENTLY_WINDOW_MS = 24 * 60 * 60 * 1000;

const COLUMN_MAX_WIDTH = 600;

const APP_STORE_URL =
  'https://apps.apple.com/us/app/duolicious-dating-app/id6499066647';

const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=app.duolicious';

const SHEET_Z_INDEX = 9999;

const LEGAL_LINKS = [
  ['FAQ', '/faq/'],
  ['Guidelines', '/guidelines/'],
  ['Terms', '/terms/'],
  ['Privacy', '/privacy/'],
  ['Consumer Health Data', '/consumer-health-data/'],
] as const;

export {
  APP_STORE_URL,
  COLUMN_MAX_WIDTH,
  LEGAL_LINKS,
  ONLINE_COLOR,
  ONLINE_RECENTLY_COLOR,
  ONLINE_RECENTLY_WINDOW_MS,
  PLAY_STORE_URL,
  SHEET_Z_INDEX,
};
