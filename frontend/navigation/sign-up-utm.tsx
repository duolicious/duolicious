import { Platform } from 'react-native';
import { getSignedInUser } from '../events/signed-in-user';

const UTM_NAMES = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
];

const splitPath = (path: string): [string, URLSearchParams] => {
  const i = path.indexOf('?');
  return i === -1
    ? [path, new URLSearchParams()]
    : [path.slice(0, i), new URLSearchParams(path.slice(i + 1))];
};

const joinPath = (pathname: string, params: URLSearchParams): string => {
  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
};

const utmsIn = (params: URLSearchParams): [string, string][] =>
  UTM_NAMES.flatMap((name): [string, string][] => {
    const value = params.get(name);
    return value ? [[name, value.slice(0, 256)]] : [];
  });

const currentUtms = (): [string, string][] =>
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? utmsIn(new URLSearchParams(window.location.search))
    : [];

const signUpUtms = (): Record<string, string> =>
  Object.fromEntries(currentUtms());

const utmQuery = (path: string): string =>
  joinPath('', new URLSearchParams(utmsIn(splitPath(path)[1])));

const withSignUpUtms = (path: string): string => {
  const utms = currentUtms();
  if (!utms.length || getSignedInUser()) return path;
  const [pathname, params] = splitPath(path);
  utms.forEach(([name, value]) => params.set(name, value));
  return joinPath(pathname, params);
};

const withoutUtms = (path: string): string => {
  const [pathname, params] = splitPath(path);
  UTM_NAMES.forEach((name) => params.delete(name));
  return joinPath(pathname, params);
};

export { signUpUtms, utmQuery, withSignUpUtms, withoutUtms };
