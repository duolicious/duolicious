import { describe, expect, test } from '@jest/globals';
import { sentMessagesInChats } from './trials';

describe('trial arms', () => {
  test.each([
    [undefined, false],
    [389200, false],
    [390248, false],
    [390249, false],
    [390250, true],
    [390251, false],
    [390252, true],
    [390253, false],
  ])('person %p', (personId, sentInChats) => {
    expect(sentMessagesInChats(personId)).toBe(sentInChats);
  });
});
