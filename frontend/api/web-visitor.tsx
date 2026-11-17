import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { japi } from './api';
import { signUpRef } from './sign-up-ref';
import { storeKv } from '../kv-storage/kv-storage';

type WebVisitorResponse = {
  web_visitor_id: string
  variants: Record<string, string>
};

let variants: Promise<Record<string, string>> = Promise.resolve({});

const storedWebVisitorId = async (): Promise<string | undefined> =>
  (await storeKv('web_visitor_id')) || undefined;

const recordWebVisit = () => {
  if (Platform.OS !== 'web') return;

  variants = (async () => {
    const response = await japi<WebVisitorResponse>('post', '/web-visitor', {
      web_visitor_id: await storedWebVisitorId(),
      ref: signUpRef,
    });

    if (!response.json) return {};

    await storeKv('web_visitor_id', response.json.web_visitor_id);

    return response.json.variants;
  })();
};

const useExperimentVariant = (experiment: string): string | null | undefined => {
  const [variant, setVariant] = useState<string | null>();

  useEffect(() => {
    variants.then((v) => setVariant(v[experiment] ?? null));
  }, [experiment]);

  return variant;
};

export {
  recordWebVisit,
  storedWebVisitorId,
  useExperimentVariant,
};
