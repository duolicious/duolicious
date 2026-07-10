import type { EmojiMartData } from '@emoji-mart/data';

type EmojiEntry = {
  id: string
  native: string
  name: string
  haystack: string
};

type EmojiSection = {
  id: string
  title: string
  emojis: EmojiEntry[]
};

// Emojis introduced after this Unicode Emoji version are excluded so the
// picker doesn't offer emojis that render as tofu on older devices.
const MAX_EMOJI_VERSION = 12;

// The chat server rejects reaction emojis longer than 16 UTF-16 units
// (`_MAX_EMOJI_LEN` in backend/chatprotocol/inbound.py).
const MAX_NATIVE_LENGTH = 16;

const CATEGORY_TITLES: { [id: string]: string } = {
  people: 'Smileys & People',
  nature: 'Animals & Nature',
  foods: 'Food & Drink',
  activity: 'Activity',
  places: 'Travel & Places',
  objects: 'Objects',
  symbols: 'Symbols',
  flags: 'Flags',
};

let cachedSections: EmojiSection[] | null = null;
let cachedAllEmojis: EmojiEntry[] | null = null;

const buildSections = (data: EmojiMartData): EmojiSection[] =>
  data.categories.flatMap((category) => {
    const title = CATEGORY_TITLES[category.id];

    if (!title) {
      return [];
    }

    const emojis = category.emojis.flatMap((emojiId) => {
      const emoji = data.emojis[emojiId];
      const native = emoji?.skins[0]?.native;

      if (!emoji || !native) {
        return [];
      }

      if (emoji.version > MAX_EMOJI_VERSION) {
        return [];
      }

      if (native.length > MAX_NATIVE_LENGTH) {
        return [];
      }

      const haystack = [emoji.id, emoji.name, ...emoji.keywords]
        .join(' ')
        .toLowerCase();

      return [{ id: emoji.id, native, name: emoji.name, haystack }];
    });

    if (!emojis.length) {
      return [];
    }

    return [{ id: category.id, title, emojis }];
  });

const getEmojiSections = (): EmojiSection[] => {
  if (!cachedSections) {
    // Loaded lazily so the ~1MB dataset isn't parsed at app startup
    cachedSections = buildSections(
      require('@emoji-mart/data') as EmojiMartData
    );
  }

  return cachedSections;
};

const getAllEmojis = (): EmojiEntry[] => {
  if (!cachedAllEmojis) {
    cachedAllEmojis = getEmojiSections().flatMap((section) => section.emojis);
  }

  return cachedAllEmojis;
};

const searchEmojis = (
  query: string,
  emojis: EmojiEntry[],
): EmojiEntry[] => {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);

  if (!tokens.length) {
    return emojis;
  }

  const matches = emojis.filter(
    (emoji) => tokens.every((token) => emoji.haystack.includes(token))
  );

  const isPrefixMatch = (emoji: EmojiEntry) =>
    emoji.id.startsWith(tokens[0]) ||
    emoji.name.toLowerCase().startsWith(tokens[0]);

  return [
    ...matches.filter(isPrefixMatch),
    ...matches.filter((emoji) => !isPrefixMatch(emoji)),
  ];
};

export {
  EmojiEntry,
  EmojiSection,
  getAllEmojis,
  getEmojiSections,
  searchEmojis,
};
