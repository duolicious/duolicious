import { describe, expect, test } from '@jest/globals';
import { clubsRedesign, sentMessagesInChats } from './trials';

describe('trial arms', () => {
  test.each([
    [undefined, false, false],
    [389200, false, false],
    [390248, false, false],
    [390249, false, false],
    [390250, true, false],
    [390251, false, false],
    [390252, true, false],
    [390253, false, false],
    [391398, true, false],
    [391399, false, false],
    [391400, false, true],
    [391401, false, true],
    [391402, false, false],
    [391403, false, false],
    [391404, false, true],
  ])('person %p', (personId, sentInChats, redesign) => {
    expect(sentMessagesInChats(personId)).toBe(sentInChats);
    expect(clubsRedesign(personId)).toBe(redesign);
  });
});
