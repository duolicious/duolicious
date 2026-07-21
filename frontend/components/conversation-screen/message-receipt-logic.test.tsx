import { describe, expect, jest, test } from '@jest/globals';
import {
  Content,
  ReceiptState,
  Side,
  contentKey,
  contentText,
  newsKey,
  readStatusDelayMs,
  receiptContent,
  useReceiptSide,
} from './message-receipt-logic';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

const DELIVERED_AT = new Date('2026-07-21T10:30:00.000Z');
const READ_AT = new Date('2026-07-21T10:31:00.000Z');

const state = (overrides: Partial<ReceiptState> = {}): ReceiptState => ({
  deliveredAt: DELIVERED_AT,
  readAt: null,
  hasGold: false,
  side: 'delivered',
  ...overrides,
});

const kindOf = (overrides: Partial<ReceiptState> = {}): Content['kind'] =>
  receiptContent(state(overrides)).kind;

describe('receiptContent', () => {
  describe('before the message is delivered', () => {
    test('the slot is blank', () => {
      expect(kindOf({ deliveredAt: null })).toEqual('blank');
    });

    test('the slot stays blank on the status side', () => {
      expect(kindOf({ deliveredAt: null, side: 'status' })).toEqual('blank');
    });
  });

  describe('on the delivered side', () => {
    test('the delivery time shows', () => {
      expect(kindOf()).toEqual('delivered');
    });

    test('the delivery time shows even once the message is read', () => {
      expect(kindOf({ readAt: READ_AT, hasGold: true })).toEqual('delivered');
    });
  });

  describe('on the status side', () => {
    test('a gold user is told the message is unread', () => {
      expect(kindOf({ side: 'status', hasGold: true })).toEqual('unread');
    });

    test('a non-gold user is shown the upsell', () => {
      expect(kindOf({ side: 'status' })).toEqual('upsell');
    });

    test('the read time outranks the unread status', () => {
      expect(kindOf({ side: 'status', readAt: READ_AT, hasGold: true }))
        .toEqual('read');
    });

    test('the read time outranks the upsell', () => {
      expect(kindOf({ side: 'status', readAt: READ_AT })).toEqual('read');
    });
  });

  describe('the timestamps it carries', () => {
    test('the delivery time is the message\'s', () => {
      expect(receiptContent(state())).toEqual(
        { kind: 'delivered', timestamp: DELIVERED_AT });
    });

    test('the read time is the receipt\'s', () => {
      expect(receiptContent(state({ side: 'status', readAt: READ_AT })))
        .toEqual({ kind: 'read', timestamp: READ_AT });
    });
  });

  test('the two sides never show the same thing', () => {
    const cases: Partial<ReceiptState>[] = [
      { hasGold: true },
      { readAt: READ_AT, hasGold: true },
      {},
      { readAt: READ_AT },
    ];

    for (const overrides of cases) {
      expect(kindOf({ ...overrides, side: 'delivered' }))
        .not.toEqual(kindOf({ ...overrides, side: 'status' }));
    }
  });
});

describe('contentKey', () => {
  test('the same content keeps the same key', () => {
    expect(contentKey({ kind: 'delivered', timestamp: DELIVERED_AT })).toEqual(
      contentKey({ kind: 'delivered', timestamp: new Date(DELIVERED_AT) }));
  });

  test('a different time is a different key', () => {
    expect(contentKey({ kind: 'delivered', timestamp: DELIVERED_AT })).not.toEqual(
      contentKey({ kind: 'delivered', timestamp: READ_AT }));
  });

  test('the same time under a different kind is a different key', () => {
    expect(contentKey({ kind: 'delivered', timestamp: DELIVERED_AT })).not.toEqual(
      contentKey({ kind: 'read', timestamp: DELIVERED_AT }));
  });

  test('every kind has its own key', () => {
    const keys = [
      contentKey({ kind: 'blank' }),
      contentKey({ kind: 'delivered', timestamp: DELIVERED_AT }),
      contentKey({ kind: 'read', timestamp: DELIVERED_AT }),
      contentKey({ kind: 'unread' }),
      contentKey({ kind: 'upsell' }),
    ];

    expect(new Set(keys).size).toEqual(keys.length);
  });
});

describe('contentText', () => {
  test('the blank slot still occupies a line', () => {
    expect(contentText({ kind: 'blank' })).toEqual('\xa0');
  });

  test('the delivery time is labelled', () => {
    expect(contentText({ kind: 'delivered', timestamp: DELIVERED_AT }))
      .toMatch(/^Delivered /);
  });

  test('a message that has been read is seen, not read', () => {
    expect(contentText({ kind: 'read', timestamp: READ_AT }))
      .toMatch(/^Seen /);
  });

  test('the unseen status is spelled out', () => {
    expect(contentText({ kind: 'unread' })).toEqual('Not seen yet');
  });

  test('the upsell keeps the name of the feature it sells', () => {
    expect(contentText({ kind: 'upsell' })).toEqual('Get read receipts');
  });
});

describe('newsKey', () => {
  test('the same delivery and read times keep the same key', () => {
    expect(newsKey(DELIVERED_AT, READ_AT))
      .toEqual(newsKey(new Date(DELIVERED_AT), new Date(READ_AT)));
  });

  test('delivery is news', () => {
    expect(newsKey(null, null)).not.toEqual(newsKey(DELIVERED_AT, null));
  });

  test('an arriving receipt is news', () => {
    expect(newsKey(DELIVERED_AT, null))
      .not.toEqual(newsKey(DELIVERED_AT, READ_AT));
  });
});

describe('useReceiptSide', () => {
  let latest: Side;

  type Props = {
    deliveredAt: Date | null
    readAt: Date | null
    pressToggle: boolean
  };

  const Probe = ({ deliveredAt, readAt, pressToggle }: Props) => {
    latest = useReceiptSide(deliveredAt, readAt, pressToggle);
    return null;
  };

  const render = (initial: Partial<Props> = {}) => {
    let props: Props = {
      deliveredAt: DELIVERED_AT,
      readAt: null,
      pressToggle: false,
      ...initial,
    };

    let renderer: { update: (element: React.ReactNode) => void };

    act(() => {
      renderer = create(<Probe {...props} />);
    });

    const set = (next: Partial<Props> = {}) => {
      props = { ...props, ...next };

      act(() => {
        renderer.update(<Probe {...props} />);
      });
    };

    return {
      set,
      press: (next: Partial<Props> = {}) =>
        set({ ...next, pressToggle: !props.pressToggle }),
    };
  };

  const wait = (ms: number) => act(() => { jest.advanceTimersByTime(ms) });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('settling on its own', () => {
    test('the slot starts on the delivery time', () => {
      render();

      expect(latest).toEqual('delivered');
    });

    test('the status takes the slot once the wait is up', () => {
      render();

      wait(readStatusDelayMs);

      expect(latest).toEqual('status');
    });

    test('the status does not take the slot early', () => {
      render();

      wait(readStatusDelayMs - 1);

      expect(latest).toEqual('delivered');
    });

    test('an arriving receipt takes the slot without waiting', () => {
      const { set } = render();

      set({ readAt: READ_AT });

      expect(latest).toEqual('status');
    });

    test('an undelivered message never starts the wait', () => {
      render({ deliveredAt: null });

      wait(readStatusDelayMs * 10);

      expect(latest).toEqual('delivered');
    });
  });

  describe('pinning by hand', () => {
    test('a press pins the other side', () => {
      const { press } = render();

      press();

      expect(latest).toEqual('status');
    });

    test('pressing again pins it back', () => {
      const { press } = render();

      press();
      press();

      expect(latest).toEqual('delivered');
    });

    test('a pinned slot does not lose the wait to the status', () => {
      const { press } = render();

      press();
      press();
      wait(readStatusDelayMs * 10);

      expect(latest).toEqual('delivered');
    });

    test('a press after the wait is up pins the delivery time', () => {
      const { press } = render();

      wait(readStatusDelayMs);
      press();

      expect(latest).toEqual('delivered');
    });

    test('a press before delivery does not stop the wait', () => {
      const { set, press } = render({ deliveredAt: null });

      press();
      set({ deliveredAt: DELIVERED_AT });
      wait(readStatusDelayMs);

      expect(latest).toEqual('status');
    });
  });

  describe('news unpinning the slot', () => {
    test('delivery settles the slot afresh', () => {
      const { set, press } = render({ deliveredAt: null });

      press();
      set({ deliveredAt: DELIVERED_AT });

      expect(latest).toEqual('delivered');
    });

    test('an arriving receipt takes the slot off what was pinned', () => {
      const { set, press } = render();

      press();
      press();
      set({ readAt: READ_AT });

      expect(latest).toEqual('status');
    });

    test('the slot can be pinned again once news has settled it', () => {
      const { set, press } = render();

      press();
      press();
      set({ readAt: READ_AT });
      press();

      expect(latest).toEqual('delivered');
    });

    test('news leaves an unpinned slot alone', () => {
      const { set } = render();

      set({ readAt: READ_AT });

      expect(latest).toEqual('status');
    });
  });
});
