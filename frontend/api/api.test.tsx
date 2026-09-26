import { jest } from '@jest/globals';

import { api, cachedGet, resetCachedResponses } from './api';
import { storeKv } from '../kv-storage/kv-storage';

jest.mock('../kv-storage/kv-storage', () => {
  const mockKv = new Map<string, string>();

  return {
    storeKv: async (key: string, value?: string | null) => {
      if (value === undefined) {
        return mockKv.get(key) ?? null;
      }
      if (value === null) {
        mockKv.delete(key);
      } else {
        mockKv.set(key, value);
      }
    },
  };
});

const responses: Promise<Response>[] = [];

const respondWith = (status: number, body?: unknown) =>
  responses.push(Promise.resolve(
    new Response(body === undefined ? null : JSON.stringify(body), { status })));

const get = () => cachedGet<{ n: number }>('/thing', ({ n }) => n !== 0);

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.spyOn(global, 'fetch').mockImplementation(() =>
    responses.shift() ?? Promise.resolve(new Response(null, { status: 500 })));
  responses.length = 0;
  await storeKv('last_write_at', null);
  await resetCachedResponses();
});

test('reuses a response until the viewer writes something', async () => {
  respondWith(200, { n: 1 });
  expect((await get()).json).toEqual({ n: 1 });
  expect((await get()).json).toEqual({ n: 1 });

  respondWith(200, {});
  await api('post', '/skip/by-uuid/someone');

  respondWith(200, { n: 2 });
  expect((await get()).json).toEqual({ n: 2 });
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('keeps responses through read-only requests', async () => {
  respondWith(200, { n: 1 });
  await get();

  respondWith(200, {});
  await api('post', '/check-session-token', undefined, { readOnly: true });
  respondWith(200, {});
  await api('get', '/other');

  expect((await get()).json).toEqual({ n: 1 });
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('drops a response that was requested before a write landed', async () => {
  let respond: (response: Response) => void = () => {};
  responses.push(new Promise((resolve) => { respond = resolve; }));
  const inFlight = get();
  await new Promise((resolve) => setTimeout(resolve, 0));

  respondWith(200, {});
  await api('post', '/answer');
  respond(new Response(JSON.stringify({ n: 1 }), { status: 200 }));
  expect((await inFlight).json).toEqual({ n: 1 });

  respondWith(200, { n: 2 });
  expect((await get()).json).toEqual({ n: 2 });
});

test('expires responses after five minutes', async () => {
  const now = Date.now();
  jest.spyOn(Date, 'now').mockReturnValue(now);
  respondWith(200, { n: 1 });
  await get();

  jest.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000);
  respondWith(200, { n: 2 });
  expect((await get()).json).toEqual({ n: 2 });
});

test("doesn't keep failures or responses the caller declines", async () => {
  respondWith(404);
  expect(await get()).toMatchObject({ json: undefined, clientError: true });

  respondWith(200, { n: 0 });
  await get();

  respondWith(200, { n: 1 });
  expect((await get()).json).toEqual({ n: 1 });
  expect(fetch).toHaveBeenCalledTimes(3);
});
