import {
  API_URL,
} from '../env/env';
import * as _ from "lodash";
import { sessionToken } from '../kv-storage/session-token';
import { storeKv } from '../kv-storage/kv-storage';
import { makeBackoff } from '../util/util';
import { nextEvent } from '../events/events';
import { EV_NETWORK_CAME_ONLINE } from '../network/network';
import { SOMETHING_WENT_WRONG, notifyErrorToast } from '../components/toast';

const CLIENT_VERSION = 11;

type ApiResponse<T = unknown> = {
  ok: boolean
  clientError: boolean
  json: T,
  text: string | undefined,
  status: number
  validationErrors: string[] | null
};

type Config = {
  timeout?: number,
  maxRetries?: number,
  showValidationToast?: boolean,
  retryOnTransientError?: boolean,
  readOnly?: boolean,
};

type CachedResponses<T> = Record<string, { json: T, requestedAt: number }>;

const parseErrors = (errors: unknown): string[] => {
  if (!Array.isArray(errors)) {
    return [SOMETHING_WENT_WRONG];
  }
  try {
    return errors.map(
      (e: { msg?: string }) => (e?.msg ?? SOMETHING_WENT_WRONG).split(",").slice(1).join(",").trim()
    );
  } catch {
    return [SOMETHING_WENT_WRONG];
  }
};

const api = async <T = unknown>(
  method: string,
  endpoint: string,
  init?: RequestInit,
  config: Config = {},
): Promise<ApiResponse<T>> => {
  const {
    timeout,
    maxRetries,
    showValidationToast,
    retryOnTransientError,
    readOnly,
  } = config;

  let response: Response | undefined;
  let json: T | undefined;
  let text: string | undefined;
  let numRetries = 0;
  const retryBackoff = makeBackoff();

  while (maxRetries === undefined || numRetries <= maxRetries) {
    [response, json] = [undefined, undefined];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout ?? 30000);

    const existingSessionToken = await sessionToken();

    const startsWithHttp = (
      endpoint.startsWith('http://') || endpoint.startsWith('https://'));
    const url = startsWithHttp ?
      endpoint :
      `${API_URL}${endpoint}`;

    const init_ = _.merge(
      {
        method: method.toUpperCase(),
        cache: 'no-store',
      },
      (
        existingSessionToken ? {
          headers: {
            'Authorization': `Bearer ${existingSessionToken}`
          }
        } :
          {}
      ),
      { signal: controller.signal },
      init,
    );

    try {
      response = await fetch(url, init_);
      if (
        retryOnTransientError &&
        (response.status === 429 ||
          (response.status >= 500 &&
           response.status <  600))
      ) {
        throw new Error();
      } else {
        break;
      }
    } catch (error) {
      numRetries++;
      const jitteredDelayMs = retryBackoff.next();

      // TODO: There should be a message in the UI saying "you're offline" or something
      console.log(`Waiting ${(jitteredDelayMs / 1000).toFixed(1)} seconds and trying again; Caught error while fetching ${url}`, error);

      await nextEvent(EV_NETWORK_CAME_ONLINE, jitteredDelayMs);
    } finally {
      // cancel the timeout whether there was an error or not
      clearTimeout(timeoutId);
    }
  }

  if (!readOnly && method.toUpperCase() !== 'GET') {
    await storeKv('last_write_at', String(Date.now()));
  }

  try { text = await response?.text(); } catch {}
  try { json = JSON.parse(text ?? ''); } catch {}

  const clientError = response && response.status >= 400 && response.status < 500;

  const validationErrors = clientError ? parseErrors(json) : null;

  if (validationErrors && showValidationToast) {
    for (const error of validationErrors) {
      notifyErrorToast(error);
    }
  }

  return {
    ok: response?.ok ?? false,
    clientError: clientError ?? false,
    json: json as T,
    text,
    status: response?.status ?? 0,
    validationErrors: validationErrors,
  }
};


const japi = async <T = unknown>(
  method: string,
  endpoint: string,
  body?: unknown,
  config?: Config,
): Promise<ApiResponse<T>> => {
  const init = body === undefined ? {} : {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body)
  }

  return await api<T>(
    method,
    endpoint,
    init,
    config,
  );
};

const readCachedResponses = async <T,>(): Promise<CachedResponses<T>> => {
  try {
    const cache: CachedResponses<T> =
      JSON.parse((await storeKv('cached_responses')) || '{}');
    return _.pickBy(cache, (c) => Date.now() - c.requestedAt < 5 * 60 * 1000);
  } catch {
    return {};
  }
};

const cachedGet = async <T,>(
  endpoint: string,
  isCacheable: (json: T) => boolean,
) => {
  const [cache, lastWriteAt] = await Promise.all([
    readCachedResponses<T>(),
    storeKv('last_write_at'),
  ]);

  const cached = cache[endpoint];

  if (cached && cached.requestedAt > Number(lastWriteAt)) {
    return { ...cached, clientError: false };
  }

  const requestedAt = Date.now();
  const response = await api<T>('get', endpoint);
  const json = response.ok ? response.json : undefined;

  if (json !== undefined && isCacheable(json)) {
    await storeKv(
      'cached_responses',
      JSON.stringify({
        ...(await readCachedResponses<T>()),
        [endpoint]: { json, requestedAt },
      }),
    );
  }

  return { json, requestedAt, clientError: response.clientError };
};

const resetCachedResponses = () => storeKv('cached_responses', null);

const uriToBase64 = async (uri: string): Promise<string> => {
  const response = await fetch(uri);
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        // Safely access the base64 content
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      } else {
        // Handle the case where reader.result is not a string
        reject(new Error("Failed to read file as base64, result is not a string."));
      }
    };

    reader.onerror = () => {
      reject(new Error("Error reading file as base64."));
    };

    reader.readAsDataURL(blob);
  });
}

export {
  CLIENT_VERSION,
  ApiResponse,
  api,
  cachedGet,
  japi,
  resetCachedResponses,
  uriToBase64,
};
