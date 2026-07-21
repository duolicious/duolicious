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

type Side = 'delivered' | 'status';

type ReceiptState = {
  deliveredAt: Date | null
  readAt: Date | null
  hasGold: boolean
  side: Side
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
  side,
}: ReceiptState): Content => {
  if (!deliveredAt) {
    return { kind: 'blank' };
  }

  if (side === 'delivered') {
    return { kind: 'delivered', timestamp: deliveredAt };
  }

  return (
    readAt ? { kind: 'read', timestamp: readAt } :
    hasGold ? { kind: 'unread' } :
    { kind: 'upsell' }
  );
};

// The status only takes the slot a few seconds after delivery, so the delivery
// time is seen before it's replaced. Pinning the slot by hand stops the wait,
// so the status can't land on top of what the user chose to see.
const useIsDelayElapsed = (
  deliveredAt: Date | null,
  isPinned: boolean,
): boolean => {
  const [isDelayElapsed, setIsDelayElapsed] = useState(false);

  useEffect(() => {
    if (!deliveredAt || isPinned) {
      return;
    }

    const timeout = setTimeout(() => setIsDelayElapsed(true), readStatusDelayMs);

    return () => clearTimeout(timeout);
  }, [deliveredAt?.getTime(), isPinned]);

  return isDelayElapsed;
};

// The slot settles on a side by itself, and each press pins it to the other
// one. Delivery or an arriving receipt is news, which unpins the slot: it
// settles afresh rather than staying on what the user last pressed to see.
const useReceiptSide = (
  deliveredAt: Date | null,
  readAt: Date | null,
  pressToggle: boolean,
): Side => {
  const news = newsKey(deliveredAt, readAt);

  const [pin, setPin] = useState<{
    side: Side | null
    news: string
    pressToggle: boolean
  }>({ side: null, news, pressToggle });

  const isDelayElapsed = useIsDelayElapsed(deliveredAt, pin.side !== null);

  const settled: Side = readAt || isDelayElapsed ? 'status' : 'delivered';

  if (pin.news !== news) {
    setPin({ side: null, news, pressToggle });

    return settled;
  }

  if (pin.pressToggle !== pressToggle) {
    const side: Side =
      (pin.side ?? settled) === 'delivered' ? 'status' : 'delivered';

    setPin({ side, news, pressToggle });

    return side;
  }

  return pin.side ?? settled;
};

export {
  Content,
  ReceiptState,
  Side,
  contentKey,
  contentText,
  deliveredText,
  newsKey,
  readStatusDelayMs,
  receiptContent,
  useReceiptSide,
};
