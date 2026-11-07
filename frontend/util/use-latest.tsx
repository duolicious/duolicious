import { useState } from 'react';

const useLatest = <T,>(value: T | null): T | null => {
  const [latest, setLatest] = useState(value);

  if (value !== null && value !== latest) {
    setLatest(value);
  }

  return value ?? latest;
};

export {
  useLatest,
};
