import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type RandomDelay = {
  min: number;
  max: number;
};

type WithDeferredMountProps = {
  children: ReactNode | (() => ReactNode);
} & ({
  /**
   * Fixed delay in milliseconds before mounting children.
   * Ignored if randomDelay is provided.
   */
  delay: number;
} | {
  /**
   * Randomized delay range (inclusive of min, exclusive of max).
   * Takes precedence over delay when provided.
   */
  randomDelay: RandomDelay;
});


const computeDelay = (props: WithDeferredMountProps): number => {
  if ('delay' in props) {
    return props.delay;
  } else {
    const { min, max } = props.randomDelay;
    return Math.floor(min + Math.random() * (max - min));
  }
};

const WithDeferredMount = (props: WithDeferredMountProps) => {
  const [delay] = useState(() => computeDelay(props));

  const [ready, setReady] = useState(delay === 0);

  useEffect(() => {
    if (ready) {
      return;
    }

    const id = setTimeout(() => setReady(true), delay);

    return () => clearTimeout(id);
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <>
      {
        typeof props.children === 'function'
          ? props.children()
          : props.children
      }
    </>
  );
};

export { WithDeferredMount };
