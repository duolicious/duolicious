import { expect, jest, test } from '@jest/globals';
import { useDraftMessage } from './draft-message';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

const mockDrafts: Record<string, string> = { A: 'draft for A', B: 'draft for B' };
const mockPending: (() => void)[] = [];

jest.mock('../../../kv-storage/draft-messages', () => ({
  getDraftMessage: (_sender: string, recipient: string) =>
    new Promise((resolve) =>
      mockPending.push(() => resolve(mockDrafts[recipient]))),
  setDraftMessage: () => Promise.resolve(),
}));

jest.mock('../../../kv-storage/session-token', () => ({
  sessionPersonUuid: () => Promise.resolve('me'),
}));

const seen: (string | null)[] = [];

const Probe = ({ recipient }: { recipient: string | undefined }) => {
  const [draft] = useDraftMessage(recipient);
  seen.push(draft);
  return null;
};

const loadDrafts = async () => {
  await act(async () => {
    while (mockPending.length) mockPending.shift()!();
  });
};

test("a conversation never shows the previous conversation's draft", async () => {
  let renderer: ReturnType<typeof create>;

  await act(async () => { renderer = create(<Probe recipient="A" />); });
  await loadDrafts();
  expect(seen.at(-1)).toBe('draft for A');

  await act(async () => { renderer.update(<Probe recipient={undefined} />); });
  expect(seen.at(-1)).toBe(null);

  seen.length = 0;
  await act(async () => { renderer.update(<Probe recipient="B" />); });
  expect(seen).not.toContain('draft for A');

  await loadDrafts();
  expect(seen.at(-1)).toBe('draft for B');
});
