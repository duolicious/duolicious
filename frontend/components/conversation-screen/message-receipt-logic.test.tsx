import { describe, expect, jest, test } from '@jest/globals';
import {
  Content,
  ReceiptState,
  contentKey,
  contentText,
  newsKey,
  readStatusDelayMs,
  receiptContent,
  useIsDelayElapsed,
  useIsSwapped,
} from './message-receipt-logic';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

const DELIVERED_AT = new Date('2026-07-21T10:30:00.000Z');
const READ_AT = new Date('2026-07-21T10:31:00.000Z');

const state = (overrides: Partial<ReceiptState> = {}): ReceiptState => ({
  deliveredAt: DELIVERED_AT,
  readAt: null,
  hasGold: false,
  isDelayElapsed: false,
  isSwapped: false,
  ...overrides,
});

const kindOf = (overrides: Partial<ReceiptState> = {}): Content['kind'] =>
  receiptContent(state(overrides)).kind;

describe('receiptContent', () => {
  describe('before the message is delivered', () => {
    test('the slot is blank', () => {
      expect(kindOf({ deliveredAt: null })).toEqual('blank');
    });

    test('the slot stays blank when pressed', () => {
      expect(kindOf({ deliveredAt: null, isSwapped: true })).toEqual('blank');
    });

    test('the slot stays blank once the delay elapses', () => {
      expect(kindOf({ deliveredAt: null, isDelayElapsed: true }))
        .toEqual('blank');
    });
  });

  describe('once delivered, before the delay elapses', () => {
    test('the delivery time shows', () => {
      expect(kindOf()).toEqual('delivered');
    });

    test('a gold user can swap to the read status', () => {
      expect(kindOf({ hasGold: true, isSwapped: true }))
        .toEqual('unread');
    });

    test('a non-gold user can swap to the upsell', () => {
      expect(kindOf({ isSwapped: true })).toEqual('upsell');
    });
  });

  describe('once the delay elapses', () => {
    test('a gold user is told the message is unread', () => {
      expect(kindOf({ hasGold: true, isDelayElapsed: true }))
        .toEqual('unread');
    });

    test('a non-gold user is shown the upsell', () => {
      expect(kindOf({ isDelayElapsed: true })).toEqual('upsell');
    });

    test('a gold user can swap to the delivery time', () => {
      expect(kindOf({
        hasGold: true,
        isDelayElapsed: true,
        isSwapped: true,
      })).toEqual('delivered');
    });

    test('a non-gold user can swap to the delivery time', () => {
      expect(kindOf({ isDelayElapsed: true, isSwapped: true }))
        .toEqual('delivered');
    });
  });

  describe('once the message is read', () => {
    test('the read time shows without waiting for the delay', () => {
      expect(kindOf({ readAt: READ_AT, hasGold: true }))
        .toEqual('read');
    });

    test('the read time outranks the unread status', () => {
      expect(kindOf({
        readAt: READ_AT,
        hasGold: true,
        isDelayElapsed: true,
      })).toEqual('read');
    });

    test('the read time outranks the upsell', () => {
      expect(kindOf({ readAt: READ_AT, isDelayElapsed: true })).toEqual('read');
    });

    test('swapping shows the delivery time', () => {
      expect(kindOf({ readAt: READ_AT, hasGold: true, isSwapped: true }))
        .toEqual('delivered');
    });
  });

  describe('the timestamps it carries', () => {
    test('the delivery time is the message\'s', () => {
      expect(receiptContent(state())).toEqual(
        { kind: 'delivered', timestamp: DELIVERED_AT });
    });

    test('the read time is the receipt\'s', () => {
      expect(receiptContent(state({ readAt: READ_AT }))).toEqual(
        { kind: 'read', timestamp: READ_AT });
    });
  });

  test('swapping always changes what is shown, whatever the state', () => {
    const swappable: Partial<ReceiptState>[] = [
      { hasGold: true },
      { hasGold: true, isDelayElapsed: true },
      { readAt: READ_AT, hasGold: true },
      {},
      { isDelayElapsed: true },
      { readAt: READ_AT },
    ];

    for (const overrides of swappable) {
      expect(kindOf({ ...overrides, isSwapped: true }))
        .not.toEqual(kindOf(overrides));
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

describe('useIsDelayElapsed', () => {
  let latest: boolean;

  const Probe = ({
    deliveredAt,
    isPressed,
  }: {
    deliveredAt: Date | null
    isPressed: boolean
  }) => {
    latest = useIsDelayElapsed(deliveredAt, isPressed);
    return null;
  };

  const render = (deliveredAt: Date | null, isPressed: boolean = false) => {
    let renderer: { update: (element: React.ReactNode) => void };

    act(() => {
      renderer = create(
        <Probe deliveredAt={deliveredAt} isPressed={isPressed} />);
    });

    return (
      nextIsPressed: boolean,
      nextDeliveredAt: Date | null = deliveredAt,
    ) => act(() => {
      renderer.update(
        <Probe deliveredAt={nextDeliveredAt} isPressed={nextIsPressed} />);
    });
  };

  const wait = (ms: number) => act(() => { jest.advanceTimersByTime(ms) });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('the delay has not elapsed to begin with', () => {
    render(DELIVERED_AT);

    expect(latest).toEqual(false);
  });

  test('the delay elapses once the wait is up', () => {
    render(DELIVERED_AT);

    wait(readStatusDelayMs);

    expect(latest).toEqual(true);
  });

  test('the delay does not elapse early', () => {
    render(DELIVERED_AT);

    wait(readStatusDelayMs - 1);

    expect(latest).toEqual(false);
  });

  test('an undelivered message never starts the wait', () => {
    render(null);

    wait(readStatusDelayMs * 10);

    expect(latest).toEqual(false);
  });

  test('a press cancels the wait', () => {
    const press = render(DELIVERED_AT);

    press(true);
    wait(readStatusDelayMs * 10);

    expect(latest).toEqual(false);
  });

  test('pressing again does not restart the wait', () => {
    const press = render(DELIVERED_AT);

    press(true);
    press(false);
    wait(readStatusDelayMs * 10);

    expect(latest).toEqual(false);
  });

  test('a press after the wait is up leaves the delay elapsed', () => {
    const press = render(DELIVERED_AT);

    wait(readStatusDelayMs);
    press(true);

    expect(latest).toEqual(true);
  });

  test('a press before delivery does not cancel the wait', () => {
    const press = render(null);

    press(true);
    press(false, DELIVERED_AT);
    wait(readStatusDelayMs);

    expect(latest).toEqual(true);
  });

  test('a press held through delivery does not cancel the wait', () => {
    const press = render(null);

    press(true);
    press(true, DELIVERED_AT);
    wait(readStatusDelayMs);

    expect(latest).toEqual(true);
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

describe('useIsSwapped', () => {
  let latest: boolean;

  const Probe = ({
    isPressed,
    newsKey,
  }: {
    isPressed: boolean
    newsKey: string
  }) => {
    latest = useIsSwapped(isPressed, newsKey);
    return null;
  };

  const render = (newsKey: string) => {
    let renderer: { update: (element: React.ReactNode) => void };

    act(() => {
      renderer = create(<Probe isPressed={false} newsKey={newsKey} />);
    });

    return (nextIsPressed: boolean, nextNewsKey: string = newsKey) => act(() => {
      renderer.update(
        <Probe isPressed={nextIsPressed} newsKey={nextNewsKey} />);
    });
  };

  test('the slot starts on the value it settled on', () => {
    render('delivered');

    expect(latest).toEqual(false);
  });

  test('a press swaps the slot', () => {
    const press = render('delivered');

    press(true);

    expect(latest).toEqual(true);
  });

  test('pressing again swaps the slot back', () => {
    const press = render('delivered');

    press(true);
    press(false);

    expect(latest).toEqual(false);
  });

  test('news takes the slot back off what the user pressed to see', () => {
    const press = render('delivered');

    press(true);
    press(true, 'read');

    expect(latest).toEqual(false);
  });

  test('the slot can be pressed again once news has reset it', () => {
    const press = render('delivered');

    press(true);
    press(true, 'read');
    press(false, 'read');

    expect(latest).toEqual(true);
  });

  test('news leaves an unpressed slot alone', () => {
    const press = render('delivered');

    press(false, 'read');

    expect(latest).toEqual(false);
  });
});
