import { jest } from '@jest/globals';

import { japi } from '../api/api';
import { notifyErrorToast } from '../components/toast';
import { consumeStaleSearchResults } from './stale-search-results';
import {
  SearchFilterAnswer,
  flushSearchFilterWrites,
  getSearchFilters,
  resetSearchFilters,
  setSearchFilterAnswer,
  setSearchFilters,
} from './search-filters';

jest.mock('../api/api', () => ({
  japi: jest.fn(async () => ({ ok: true })),
}));

jest.mock('../components/toast', () => ({
  notifyErrorToast: jest.fn(),
}));

const filter = (
  question_id: number,
  answer: boolean | null,
  accept_unanswered = true,
): SearchFilterAnswer => ({
  question_id,
  question: `Question ${question_id}?`,
  topic: 'Values',
  answer,
  accept_unanswered,
});

const sentBodies = () =>
  jest.mocked(japi).mock.calls.map(([, , body]) => body);

beforeEach(() => {
  jest.mocked(japi).mockClear();
  jest.mocked(notifyErrorToast).mockClear();
  resetSearchFilters();
  consumeStaleSearchResults();
  setSearchFilters({ answer: [filter(5, true)] });
});

test('updates the store before anything is sent', () => {
  setSearchFilterAnswer(filter(3, false));
  setSearchFilterAnswer(filter(5, null));

  expect(getSearchFilters()?.answer).toEqual([filter(3, false)]);
  expect(japi).not.toHaveBeenCalled();
});

test('sends only the last change to each question, then marks results stale', async () => {
  setSearchFilterAnswer(filter(7, true));
  setSearchFilterAnswer(filter(5, false));
  setSearchFilterAnswer(filter(7, false));
  setSearchFilterAnswer(filter(7, false, false));

  await flushSearchFilterWrites();

  expect(sentBodies()).toEqual([
    { question_id: 7, answer: false, accept_unanswered: false },
    { question_id: 5, answer: false, accept_unanswered: true },
  ]);
  expect(consumeStaleSearchResults()).toBe(true);
});

test('keeps filters in question order', () => {
  setSearchFilterAnswer(filter(9, true));
  setSearchFilterAnswer(filter(1, true));

  expect(getSearchFilters()?.answer?.map((a) => a.question_id))
    .toEqual([1, 5, 9]);
});

test('sends nothing when clearing a question without a filter', async () => {
  setSearchFilterAnswer(filter(3, null));

  await flushSearchFilterWrites();

  expect(japi).not.toHaveBeenCalled();
});

test('refuses a filter beyond the limit but still edits existing ones', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => filter(i + 1, true));
  setSearchFilters({ answer: twenty });

  setSearchFilterAnswer(filter(21, true));
  expect(getSearchFilters()?.answer).toEqual(twenty);
  expect(notifyErrorToast).toHaveBeenCalledTimes(1);

  setSearchFilterAnswer(filter(20, false));
  expect(getSearchFilters()?.answer?.[19]).toEqual(filter(20, false));
});

test('drops unsent changes on sign-out', async () => {
  setSearchFilterAnswer(filter(7, true));
  resetSearchFilters();

  await flushSearchFilterWrites();

  expect(japi).not.toHaveBeenCalled();
});
