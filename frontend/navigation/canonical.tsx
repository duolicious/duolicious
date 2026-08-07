import { Platform } from 'react-native';

// Both duolicious.app and web.duolicious.app serve this app, so every
// route advertises its duolicious.app URL to crawlers regardless of the
// origin it happens to be served from; the apex domain is the canonical
// home.
const CANONICAL_ORIGIN = 'https://duolicious.app';

const updateCanonicalUrlOnWeb = (path: string): void => {
  if (Platform.OS !== 'web') return;

  const pathname = path.split('?')[0];

  const existing =
    document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const link = existing ?? document.createElement('link');
  if (!existing) {
    link.rel = 'canonical';
    document.head.appendChild(link);
  }

  link.href = `${CANONICAL_ORIGIN}${pathname}`;
};

export { updateCanonicalUrlOnWeb };
