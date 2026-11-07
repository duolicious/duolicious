import { useDerivedEvent } from './events';

const useRetained = <T,>(key: string | undefined): T | null =>
  useDerivedEvent<T, T | null>(key, (v) => v ?? null, []);

export {
  useRetained,
};
