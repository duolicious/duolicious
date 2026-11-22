import { useEffect } from 'react';
import { Platform } from 'react-native';
import { japi } from './api';

const webVisitorId = ((): string | undefined => {
  if (Platform.OS !== 'web') return undefined;

  try {
    const id = localStorage.getItem('web_visitor_id') ?? crypto.randomUUID();
    localStorage.setItem('web_visitor_id', id);
    return id;
  } catch {
    return undefined;
  }
})();

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

const reported = new Set<string>();

const useExperimentVariant = <const V extends readonly [string, ...string[]]>(
  experiment: string,
  variants: V,
): V[number] => {
  const variant = webVisitorId === undefined
    ? variants[0]
    : variants[hash(`${webVisitorId}:${experiment}`) % variants.length];

  useEffect(() => {
    if (webVisitorId === undefined || reported.has(experiment)) return;
    reported.add(experiment);
    japi('post', '/experiment-exposure', {
      web_visitor_id: webVisitorId,
      experiment,
      variant,
    });
  }, [experiment, variant]);

  return variant;
};

export {
  webVisitorId,
  useExperimentVariant,
};
