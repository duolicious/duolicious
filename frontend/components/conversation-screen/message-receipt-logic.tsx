import { useState } from 'react';
import { longFriendlyTimestamp } from '../../util/util';

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

  const settled: Side = readAt ? 'status' : 'delivered';

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
  receiptContent,
  useReceiptSide,
};
