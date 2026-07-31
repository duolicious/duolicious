import {
  formatCount,
  friendlyTimeAgo,
  friendlyTimeSince,
  truncateText,
} from './util';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

describe('truncateText', () => {
  /* ──────────────────────────────────────────────────────────── *
   *   No‑op cases (should not truncate, no ellipsis added)       *
   * ──────────────────────────────────────────────────────────── */
  it('returns the original text when no limits are reached', () => {
    const text = 'Hello world';
    expect(truncateText(text, { maxLength: 20 })).toBe(text);
    expect(truncateText(text, { maxLines: 3 })).toBe(text);
    expect(truncateText(text, {})).toBe(text);
  });

  it('does not truncate when length exactly equals maxLength', () => {
    const text = '12345';
    expect(truncateText(text, { maxLength: 5 })).toBe(text);
  });

  /* ──────────────────────────────────────────────────────────── *
   *   Length‑wise truncation                                     *
   * ──────────────────────────────────────────────────────────── */
  it('truncates by length and appends an ellipsis', () => {
    const long = 'abcdefghijklmnopqrstuvwxyz';
    const result = truncateText(long, { maxLength: 10 });

    expect(result).toBe('abcdefghij…');          // first 10 chars + ellipsis
    // Length should be maxLength + 1 (for the ellipsis)
    expect(Array.from(result).length).toBe(11);
    expect(result.endsWith('…')).toBe(true);
  });

  it('counts Unicode grapheme clusters correctly', () => {
    const thumbs = '👍👍👍👍👍';                   // 5 emoji
    const result = truncateText(thumbs, { maxLength: 3 });

    expect(result).toBe('👍👍👍…');
    expect(Array.from(result).length).toBe(4);   // 3 glyphs + ellipsis
  });

  /* ──────────────────────────────────────────────────────────── *
   *   Line‑wise truncation                                       *
   * ──────────────────────────────────────────────────────────── */
  it('truncates by number of lines and appends an ellipsis', () => {
    const multiLine = ['line1', 'line2', 'line3'].join('\n');
    const result = truncateText(multiLine, { maxLines: 2 });

    expect(result).toBe('line1\nline2…');
    expect(result.endsWith('…')).toBe(true);
    expect(result.split('\n').length).toBe(2);   // now only two lines
  });

  /* ──────────────────────────────────────────────────────────── *
   *   Combined limits                                            *
   * ──────────────────────────────────────────────────────────── */
  it('applies line‑wise first, then length‑wise truncation', () => {
    const text = ['1234567890', 'abcdefghij', 'klmnopqrst'].join('\n');
    // After line truncation we have "1234567890\nabcdefghij"
    // Then length truncation to 15 chars keeps "1234567890\nabcd"
    const result = truncateText(text, { maxLines: 2, maxLength: 15 });

    expect(result).toBe('1234567890\nabcd…');
    expect(result.endsWith('…')).toBe(true);
    expect(Array.from(result).length).toBe(16);  // 15 + ellipsis
  });
});

describe('formatCount', () => {
  it('returns the number as a string below 1000', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1)).toBe('1');
    expect(formatCount(10)).toBe('10');
    expect(formatCount(100)).toBe('100');
    expect(formatCount(999)).toBe('999');
  });

  it('formats thousands with K, no decimal for whole numbers', () => {
    expect(formatCount(1_000)).toBe('1K');
    expect(formatCount(2_000)).toBe('2K');
    expect(formatCount(42_000)).toBe('42K');
    expect(formatCount(100_000)).toBe('100K');
    expect(formatCount(999_000)).toBe('999K');
  });

  it('formats thousands with one decimal place when needed', () => {
    expect(formatCount(1_100)).toBe('1.1K');
    expect(formatCount(1_500)).toBe('1.5K');
    expect(formatCount(42_500)).toBe('42.5K');
  });

  it('formats millions with M, no decimal for whole numbers', () => {
    expect(formatCount(1_000_000)).toBe('1M');
    expect(formatCount(10_000_000)).toBe('10M');
  });

  it('formats millions with one decimal place when needed', () => {
    expect(formatCount(1_100_000)).toBe('1.1M');
    expect(formatCount(2_500_000)).toBe('2.5M');
  });
});

describe('friendlyTimeSince', () => {
  it('shows minutes for less than an hour', () => {
    expect(friendlyTimeSince(0)).toBe('1m');
    expect(friendlyTimeSince(30 * 1000)).toBe('1m');
    expect(friendlyTimeSince(3 * MINUTE_MS + 45 * 1000)).toBe('3m');
    expect(friendlyTimeSince(59 * MINUTE_MS)).toBe('59m');
  });

  it('shows minutes when the clock runs backwards', () => {
    expect(friendlyTimeSince(-5 * MINUTE_MS)).toBe('1m');
  });

  it('shows hours right up to the end of the window', () => {
    expect(friendlyTimeSince(HOUR_MS)).toBe('1h');
    expect(friendlyTimeSince(5 * HOUR_MS + 59 * MINUTE_MS)).toBe('5h');
    expect(friendlyTimeSince(22 * HOUR_MS)).toBe('22h');
    expect(friendlyTimeSince(23 * HOUR_MS)).toBe('23h');
    expect(friendlyTimeSince(DAY_MS - 1)).toBe('23h');
  });

  // Expiring a sighting is `useOnline`'s job, not the formatter's, so the
  // ladder keeps counting past the point the indicator stops rendering.
  it('keeps counting hours once a day has passed', () => {
    expect(friendlyTimeSince(DAY_MS)).toBe('24h');
    expect(friendlyTimeSince(3 * DAY_MS)).toBe('72h');
  });
});

describe('friendlyTimeAgo', () => {
  it('describes the elapsed time in words', () => {
    expect(friendlyTimeAgo(0)).toBe('Less than a minute');
    expect(friendlyTimeAgo(5 * MINUTE_MS)).toBe('5 minutes');
    expect(friendlyTimeAgo(2 * HOUR_MS)).toBe('About 2 hours');
    expect(friendlyTimeAgo(DAY_MS)).toBe('1 day');
    expect(friendlyTimeAgo(40 * DAY_MS)).toBe('About 1 month');
  });

  it('treats a backwards clock as no time elapsed', () => {
    expect(friendlyTimeAgo(-5 * MINUTE_MS)).toBe(friendlyTimeAgo(0));
  });
});
