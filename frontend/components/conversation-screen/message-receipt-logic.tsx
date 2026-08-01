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

type ContentParts = { label: string, detail: string };

const contentParts = (content: Content): ContentParts => {
  switch (content.kind) {
    case 'blank':
      return { label: '', detail: '\xa0' };
    case 'delivered':
      return {
        label: 'Delivered',
        detail: ` ${longFriendlyTimestamp(content.timestamp)}`,
      };
    case 'read':
      return {
        label: 'Seen',
        detail: ` ${longFriendlyTimestamp(content.timestamp)}`,
      };
    case 'unread':
      return { label: 'Not seen yet', detail: '' };
    case 'upsell':
      return { label: '', detail: 'Get read receipts' };
  }
};

const contentText = (content: Content): string => {
  const { label, detail } = contentParts(content);

  return label + detail;
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
  hasGold: boolean,
  pressToggle: boolean,
): Side => {
  const news = newsKey(deliveredAt, readAt);

  const [pin, setPin] = useState<{
    side: Side | null
    news: string
    pressToggle: boolean
  }>({ side: null, news, pressToggle });

  const settled: Side = readAt || !hasGold ? 'status' : 'delivered';

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
  contentParts,
  contentText,
  newsKey,
  receiptContent,
  useReceiptSide,
};
