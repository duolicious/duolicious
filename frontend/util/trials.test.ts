import { describe, expect, test } from '@jest/globals';
import { introMessagePreviews, landingTab, sentMessagesInChats } from './trials';

describe('trial arms', () => {
  test.each([
    [undefined, 'Q&A', false, false],
    [389192, 'Q&A', false, false],
    [389199, 'Q&A', false, false],
    [389200, 'Search', true, true],
    [389201, 'Q&A', true, true],
    [389202, 'Search', false, true],
    [389204, 'Search', true, false],
    [389207, 'Q&A', false, false],
  ])('person %p', (personId, tab, previews, sentInChats) => {
    expect(landingTab(personId)).toBe(tab);
    expect(introMessagePreviews(personId)).toBe(previews);
    expect(sentMessagesInChats(personId)).toBe(sentInChats);
  });
});
