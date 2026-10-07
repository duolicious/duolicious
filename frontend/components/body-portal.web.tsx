import { ReactNode, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const BodyPortal = ({ children }: { children: ReactNode }) => {
  const [element] = useState(() => document.createElement('div'));

  useLayoutEffect(() => {
    document.body.appendChild(element);
    return () => element.remove();
  }, [element]);

  return createPortal(children, element);
};

export {
  BodyPortal,
};
