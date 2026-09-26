import { describe, expect, test } from '@jest/globals';
import {
  LookingForData,
  describeLongDistance,
  lookingForDescription,
  lookingForEmoji,
} from './looking-for';

const ALL_GENDERS = [
  'Man',
  'Woman',
  'Agender',
  'Femboy',
  'Intersex',
  'Non-binary',
  'Transgender',
  'Trans woman',
  'Trans man',
  'Other',
];

// Matches the en-dash used by the formatter, so test expectations stay legible.
const NDASH = '\u2013';

describe('lookingForDescription', () => {
  describe('genders', () => {
    test('says "all kinds of people" when every gender is selected', () => {
      const data: LookingForData = { gender_preference: ALL_GENDERS };
      expect(lookingForDescription(data)).toBe('all kinds of people');
    });

    test('says "all kinds of people" when no gender preference is set (accept-all default)', () => {
      expect(lookingForDescription({ gender_preference: [] }))
        .toBe('all kinds of people');
      expect(lookingForDescription({ gender_preference: null }))
        .toBe('all kinds of people');
      expect(lookingForDescription({})).toBe('all kinds of people');
    });

    test('pluralizes a single gender', () => {
      expect(lookingForDescription({ gender_preference: ['Woman'] }))
        .toBe('women');
      expect(lookingForDescription({ gender_preference: ['Man'] }))
        .toBe('men');
    });

    test('joins two genders with "and"', () => {
      expect(lookingForDescription({ gender_preference: ['Man', 'Woman'] }))
        .toBe('men and women');
    });

    test('joins three or more genders with commas and a trailing "and"', () => {
      expect(lookingForDescription({
        gender_preference: ['Man', 'Woman', 'Femboy'],
      })).toBe('men, women and femboys');
    });

    test('uses the special plural phrases for non-binary genders', () => {
      expect(lookingForDescription({ gender_preference: ['Non-binary'] }))
        .toBe('non-binary people');
      expect(lookingForDescription({ gender_preference: ['Trans woman'] }))
        .toBe('trans women');
    });

    test('falls back to a lower-cased label for unknown genders', () => {
      expect(lookingForDescription({ gender_preference: ['Aliens'] }))
        .toBe('aliens');
    });
  });

  describe('age', () => {
    test('shows both bounds when the range is narrowed at both ends', () => {
      expect(lookingForDescription({
        gender_preference: ['Woman'],
        age_preference: { min_age: 22, max_age: 30 },
      })).toBe(`women aged 22${NDASH}30`);
    });

    test('omits the age clause for the full 18-99 range', () => {
      expect(lookingForDescription({
        gender_preference: ['Woman'],
        age_preference: { min_age: 18, max_age: 99 },
      })).toBe('women');
      expect(lookingForDescription({
        gender_preference: ['Woman'],
        age_preference: { min_age: null, max_age: null },
      })).toBe('women');
      expect(lookingForDescription({
        gender_preference: ['Woman'],
        age_preference: null,
      })).toBe('women');
    });

    test('uses open-ended phrasing when only one bound is set', () => {
      expect(lookingForDescription({
        gender_preference: ['Woman'],
        age_preference: { min_age: 25, max_age: 99 },
      })).toBe('women aged 25+');
      expect(lookingForDescription({
        gender_preference: ['Woman'],
        age_preference: { min_age: null, max_age: 40 },
      })).toBe('women aged up to 40');
    });
  });

  describe('relationship goal', () => {
    test('appends a lower-cased goal clause when present', () => {
      expect(lookingForDescription({
        gender_preference: ['Woman'],
        age_preference: { min_age: 22, max_age: 30 },
        looking_for: 'Short-term dating',
      })).toBe(`women aged 22${NDASH}30 for short-term dating`);
    });

    test('reads naturally when the age clause is omitted', () => {
      expect(lookingForDescription({
        gender_preference: ['Woman'],
        looking_for: 'Short-term dating',
      })).toBe('women for short-term dating');
    });

    test('collapses "people for <goal>" to just the goal', () => {
      expect(lookingForDescription({ looking_for: 'Friends' }))
        .toBe('friends');
      expect(lookingForDescription({
        gender_preference: ALL_GENDERS,
        looking_for: 'Short-term dating',
      })).toBe('short-term dating');
      expect(lookingForDescription({ looking_for: 'Marriage' }))
        .toBe('marriage');
    });

    test('keeps "people" when an age clause is also present', () => {
      expect(lookingForDescription({
        looking_for: 'Friends',
        age_preference: { min_age: 25, max_age: 99 },
      })).toBe('people aged 25+ for friends');
    });

    test('omits the goal clause when not set', () => {
      expect(lookingForDescription({
        gender_preference: ['Woman'],
        looking_for: null,
      })).toBe('women');
    });
  });

  describe('long distance', () => {
    test('appends the long-distance clause when answered', () => {
      expect(lookingForDescription({
        gender_preference: ['Woman'],
        looking_for: 'Short-term dating',
        long_distance: 'Yes',
      })).toBe('women for short-term dating, open to long distance');
    });

    test('omits the long-distance clause when unanswered', () => {
      expect(lookingForDescription({
        gender_preference: ['Woman'],
        looking_for: 'Short-term dating',
        long_distance: null,
      })).toBe('women for short-term dating');
    });
  });

  test('builds the full example description', () => {
    expect(lookingForDescription({
      gender_preference: ['Woman'],
      age_preference: { min_age: 18, max_age: 99 },
      looking_for: 'Short-term dating',
    })).toBe('women for short-term dating');
  });
});

describe('describeLongDistance', () => {
  test('describes openness to long distance', () => {
    expect(describeLongDistance({ long_distance: 'Yes' }))
      .toBe('open to long distance');
    expect(describeLongDistance({ long_distance: 'No' }))
      .toBe('not open to long distance');
  });

  test('returns null when unanswered', () => {
    expect(describeLongDistance({ long_distance: null })).toBeNull();
    expect(describeLongDistance({})).toBeNull();
  });
});

describe('lookingForEmoji', () => {
  test('picks an emoji per relationship goal', () => {
    expect(lookingForEmoji({ looking_for: 'Friends' })).toBe('👋');
    expect(lookingForEmoji({ looking_for: 'Short-term dating' })).toBe('🥂');
    expect(lookingForEmoji({ looking_for: 'Long-term dating' })).toBe('💘');
    expect(lookingForEmoji({ looking_for: 'Marriage' })).toBe('💍');
  });

  test('falls back to a default emoji when the goal is missing or unknown', () => {
    expect(lookingForEmoji({ looking_for: null })).toBe('💞');
    expect(lookingForEmoji({ looking_for: 'Situationship' })).toBe('💞');
    expect(lookingForEmoji({})).toBe('💞');
    expect(lookingForEmoji(null)).toBe('💞');
    expect(lookingForEmoji(undefined)).toBe('💞');
  });
});
