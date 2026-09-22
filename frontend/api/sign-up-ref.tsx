import { Platform } from 'react-native';

const takeSignUpRef = (): string | undefined => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
  const { pathname, search, hash } = window.location;
  const params = new URLSearchParams(search);
  const ref = params.get('ref');
  if (!ref) return undefined;
  params.delete('ref');
  const query = params.toString();
  window.history.replaceState(
    window.history.state,
    '',
    pathname + (query ? `?${query}` : '') + hash,
  );
  return ref.slice(0, 256);
};

const signUpRef = takeSignUpRef();

export { signUpRef };
