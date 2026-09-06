import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

// Required so that the OAuth redirect dismisses the in-app browser
// session on iOS / Android. Calling this once at module load is the
// pattern documented by Expo.
WebBrowser.maybeCompleteAuthSession();

// OAuth callbacks (Apple sign-in, Spotify connect) return to the SPA with
// the result in the query string, but the navigation container rewrites the
// URL (stripping those params) as soon as it mounts. Snapshot the query at
// module load - which runs on the fresh page load before navigation mounts -
// so the return can still be read once the consuming screen mounts.
let _webReturnSearch =
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.search
    : '';

const hasWebReturnParams = (names: string[]): boolean => {
  const params = new URLSearchParams(_webReturnSearch);
  return names.some((name) => params.has(name));
};

const takeWebReturnParams = (names: string[]): URLSearchParams | null => {
  if (!hasWebReturnParams(names)) return null;
  const params = new URLSearchParams(_webReturnSearch);
  _webReturnSearch = '';

  try {
    const url = new URL(window.location.href);
    names.forEach((name) => url.searchParams.delete(name));
    const cleanSearch = url.searchParams.toString();
    window.history.replaceState(
      null,
      '',
      url.pathname + (cleanSearch ? `?${cleanSearch}` : '') + url.hash,
    );
  } catch {}

  return params;
};

const parseQueryParams = (url: string): URLSearchParams => {
  // Some browsers/env may not populate URL.searchParams from a relative-ish
  // string; parse the query manually as a fallback.
  try {
    return new URL(url).searchParams;
  } catch {
    const q = url.split('?')[1] ?? '';
    return new URLSearchParams(q.split('#')[0]);
  }
};

export {
  hasWebReturnParams,
  parseQueryParams,
  takeWebReturnParams,
};
