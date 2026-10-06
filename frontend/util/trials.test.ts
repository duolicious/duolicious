import { describe, expect, test } from '@jest/globals';
import { sentMessagesInChats } from './trials';

describe('trial arms', () => {
  test.each([
    [undefined, false],
    [389200, false],
    [390698, false],
    [390699, false],
    [390700, true],
    [390701, false],
    [390702, true],
    [390703, false],
  ])('person %p', (personId, sentInChats) => {
    expect(sentMessagesInChats(personId)).toBe(sentInChats);
  });
});
