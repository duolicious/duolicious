import {
  getAllEmojis,
  getEmojiSections,
  searchEmojis,
} from './emoji-index';

describe('getEmojiSections', () => {
  it('returns the categories in dataset order with display titles', () => {
    const sections = getEmojiSections();

    expect(sections.map((section) => section.id)).toEqual([
      'people',
      'nature',
      'foods',
      'activity',
      'places',
      'objects',
      'symbols',
      'flags',
    ]);

    expect(sections[0].title).toBe('Smileys & People');
  });

  it('only contains entries with a renderable native emoji', () => {
    for (const emoji of getAllEmojis()) {
      expect(emoji.native).toBeTruthy();
      expect(emoji.native.length).toBeLessThanOrEqual(16);
    }
  });

  it('excludes emojis newer than the supported unicode version', () => {
    const ids = getAllEmojis().map((emoji) => emoji.id);

    // Introduced in Emoji 1.0 and 12.0 respectively
    expect(ids).toContain('grinning');
    expect(ids).toContain('yawning_face');

    // Introduced in Emoji 13.0 and 14.0 respectively
    expect(ids).not.toContain('smiling_face_with_tear');
    expect(ids).not.toContain('melting_face');
  });
});

describe('searchEmojis', () => {
  const all = getAllEmojis();

  it('matches by name', () => {
    const results = searchEmojis('grinning face', all);

    expect(results.map((emoji) => emoji.id)).toContain('grinning');
  });

  it('matches by keyword', () => {
    const results = searchEmojis('happy', all);

    expect(results.map((emoji) => emoji.native)).toContain('😀');
  });

  it('requires every token to match', () => {
    const results = searchEmojis('red heart', all);

    expect(results.map((emoji) => emoji.id)).toContain('heart');
    expect(results.length).toBeLessThan(searchEmojis('heart', all).length);
  });

  it('is case-insensitive', () => {
    expect(searchEmojis('GRINNING', all)).toEqual(
      searchEmojis('grinning', all)
    );
  });

  it('ranks prefix matches before substring matches', () => {
    const bobcat = {
      id: 'bobcat',
      native: '🐈',
      name: 'Bobcat',
      haystack: 'bobcat animal',
    };
    const cat = {
      id: 'cat',
      native: '🐱',
      name: 'Cat Face',
      haystack: 'cat cat face pet',
    };

    expect(searchEmojis('cat', [bobcat, cat])).toEqual([cat, bobcat]);
  });

  it('returns everything for empty and whitespace-only queries', () => {
    expect(searchEmojis('', all)).toEqual(all);
    expect(searchEmojis('   ', all)).toEqual(all);
  });

  it('returns nothing when nothing matches', () => {
    expect(searchEmojis('zzzzzzzz', all)).toEqual([]);
  });
});
