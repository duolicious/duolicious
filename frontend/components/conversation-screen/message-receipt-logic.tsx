import { useEffect, useState } from 'react';
import { longFriendlyTimestamp } from '../../util/util';

const readStatusDelayMs = 3000;

const newsKey = (deliveredAt: Date | null, readAt: Date | null): string =>
  `${deliveredAt?.getTime() ?? 0}-${readAt?.getTime() ?? 0}`;

type Content =
  | { kind: 'blank' }
  | { kind: 'delivered', timestamp: Date }
  | { kind: 'read', timestamp: Date }
  | { kind: 'unread' }
  | { kind: 'upsell' };

type ReceiptState = {
  deliveredAt: Date | null
  readAt: Date | null
  hasGold: boolean
  isDelayElapsed: boolean
  isSwapped: boolean
};

const contentKey = (content: Content): string =>
  content.kind === 'delivered' || content.kind === 'read'
    ? `${content.kind}-${content.timestamp.getTime()}`
    : content.kind;

const deliveredText = (timestamp: Date): string =>
  `Delivered ${longFriendlyTimestamp(timestamp)}`;

const contentText = (content: Content): string => {
  switch (content.kind) {
    case 'blank': return '\xa0';
    case 'delivered': return deliveredText(content.timestamp);
    case 'read': return `Seen ${longFriendlyTimestamp(content.timestamp)}`;
    case 'unread': return 'Not seen yet';
    case 'upsell': return 'Get read receipts';
  }
};

const receiptContent = ({
  deliveredAt,
  readAt,
  hasGold,
  isDelayElapsed,
  isSwapped,
}: ReceiptState): Content => {
  if (!deliveredAt) {
    return { kind: 'blank' };
  }

  const delivered: Content = { kind: 'delivered', timestamp: deliveredAt };

  const read: Content =
    readAt ? { kind: 'read', timestamp: readAt } :
    hasGold ? { kind: 'unread' } :
    { kind: 'upsell' };

  const settled = readAt || isDelayElapsed ? read : delivered;

  if (!isSwapped) {
    return settled;
  }

  return settled.kind === 'delivered' ? read : delivered;
};

// A press swaps the slot away from whatever it had settled on. Delivery or an
// arriving receipt is news, and takes the slot back off what the user pressed
// to see: the baseline resets, so the swap starts over from the new value.
const useIsSwapped = (isPressed: boolean, newsKey: string): boolean => {
  const [baseline, setBaseline] = useState({ isPressed, newsKey });

  if (baseline.newsKey !== newsKey) {
    setBaseline({ isPressed, newsKey });

    return false;
  }

  return isPressed !== baseline.isPressed;
};

// The read status only takes the slot a few seconds after delivery, so the
// delivery time is seen before it's replaced. A press settles the slot by hand,
// which cancels the swap for good rather than letting it land on top.
const useIsDelayElapsed = (
  deliveredAt: Date | null,
  isPressed: boolean,
): boolean => {
  const [isDelayElapsed, setIsDelayElapsed] = useState(false);
  const [isCancelled, setIsCancelled] = useState(false);

  // Keyed on `isPressed` alone so it reads the delivery state at the moment of
  // the press: pressing a blank slot isn't a choice about a status that isn't
  // there yet, so it mustn't cancel the swap the delivery goes on to start.
  useEffect(() => {
    if (!isPressed || !deliveredAt) {
      return;
    }

    setIsCancelled(true);
  }, [isPressed]);

  useEffect(() => {
    if (!deliveredAt || isCancelled) {
      return;
    }

    const timeout = setTimeout(() => setIsDelayElapsed(true), readStatusDelayMs);

    return () => clearTimeout(timeout);
  }, [deliveredAt?.getTime(), isCancelled]);

  return isDelayElapsed;
};

export {
  Content,
  ReceiptState,
  contentKey,
  contentText,
  deliveredText,
  newsKey,
  readStatusDelayMs,
  receiptContent,
  useIsDelayElapsed,
  useIsSwapped,
};
