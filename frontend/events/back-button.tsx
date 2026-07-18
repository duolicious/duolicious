import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { lastEvent, listen, notify } from './events';

const EVENT_KEY = 'back-button';

type BackButtonPlacement = {
  layout: 'column' | 'window'
  transition: 'fade' | 'instant'
  onPress: () => void
};

type BackButtonClaim = {
  placement: BackButtonPlacement | null
  focused: boolean
  closing: boolean
};

type BackButtonState = {
  placement: BackButtonPlacement | null
  pressable: boolean
};

const hiddenState: BackButtonState = { placement: null, pressable: false };

const claims = new Map<number, BackButtonClaim>();
let nextKey = 0;

const computeState = (): BackButtonState => {
  const stack = [...claims.values()];
  const focused = stack.filter((claim) => claim.focused).pop();

  if (!focused) return hiddenState;

  if (!focused.closing) {
    return { placement: focused.placement, pressable: true };
  }

  const revealed = stack
    .slice(0, stack.indexOf(focused))
    .filter((claim) => !claim.closing)
    .pop();

  return revealed
    ? { placement: revealed.placement, pressable: false }
    : hiddenState;
};

const notifyState = () => {
  notify<BackButtonState>(EVENT_KEY, computeState());
};

const getBackButtonState = (): BackButtonState =>
  lastEvent<BackButtonState>(EVENT_KEY) ?? hiddenState;

const useBackButtonState = (): BackButtonState => {
  const [state, setState] = useState(getBackButtonState);

  useLayoutEffect(() => {
    return listen<BackButtonState>(
      EVENT_KEY,
      (s) => setState(s ?? hiddenState),
      true,
    );
  }, []);

  return state;
};

const useBackButtonClaim = (
  placement: BackButtonPlacement | null,
): (() => void) => {
  const keyRef = useRef<number | null>(null);
  if (keyRef.current === null) keyRef.current = nextKey++;
  const key = keyRef.current;

  const focused = useIsFocused();

  const onPressRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    onPressRef.current = placement?.onPress ?? (() => {});
  });

  const layout = placement?.layout ?? null;
  const transition = placement?.transition ?? null;

  const stablePlacement = useMemo(
    (): BackButtonPlacement | null =>
      layout && transition
        ? { layout, transition, onPress: () => onPressRef.current() }
        : null,
    [layout, transition],
  );

  useLayoutEffect(() => {
    const existing = claims.get(key);
    claims.set(key, {
      placement: stablePlacement,
      focused,
      closing: existing?.closing ?? false,
    });
    notifyState();
  }, [key, stablePlacement, focused]);

  useLayoutEffect(() => {
    return () => {
      claims.delete(key);
      notifyState();
    };
  }, [key]);

  return useCallback(() => {
    const claim = claims.get(key);
    if (!claim || claim.closing) return;
    claims.set(key, { ...claim, closing: true });
    notifyState();
  }, [key]);
};

export {
  getBackButtonState,
  useBackButtonClaim,
  useBackButtonState,
};

export type {
  BackButtonPlacement,
};
