import { useEffect, useState } from 'react';
import { z } from 'zod';
import * as _ from 'lodash';
import {
  listen,
  notify,
  lastEvent,
} from '../../../events/events';
import {
  send,
  EV_CHAT_WS_RECEIVE,
} from '../../websocket-layer';
import { awaitFocusedConversationFetch } from '../../conversation-priority';

// Event keys
const EVENT_NUM_VISITORS = 'num-visitors';

const EVENT_VISITORS_LAST_VISITED_AT = 'visitors-last-visited-at';

const DataItemSchema = z.object({
  person_uuid: z.string(),
  url_slug: z.string().nullable(),
  photo_uuid: z.string().nullable(),
  photo_blurhash: z.string().nullable(),
  time: z.string(),
  name: z.string(),
  age: z.number().nullable(),
  gender: z.string(),
  location: z.string().nullable(),
  is_verified: z.boolean(),
  match_percentage: z.number(),
  verification_required_to_view: z.union([
    z.literal('photos'),
    z.literal('basics'),
    z.null(),
  ]),
  is_new: z.boolean(),
  was_invisible: z.boolean(),
});

const DataSchema = z.object({
  visited_you: z.array(DataItemSchema),
  you_visited: z.array(DataItemSchema),
  last_visited_at: z.string().nullable(),
});

type DataItem = z.infer<typeof DataItemSchema>;
type Data = z.infer<typeof DataSchema>;

type SectionKey = 'visited_you' | 'you_visited';

const isValidData = (item: unknown): item is Data => {
  const result = DataSchema.safeParse(item);

  if (!result.success) {
    console.warn(result.error);
  }

  return result.success;
};

const isValidDataItem = (item: unknown): item is DataItem => {
  const result = DataItemSchema.safeParse(item);

  if (!result.success) {
    console.warn(result.error);
  }

  return result.success;
};

const sectionRowKeys = (
  sectionKey: SectionKey,
  items: DataItem[],
): string[] =>
  items.map((item) => `${sectionKey}-${item.person_uuid}`);

const setNumVisitors = (num: number) => {
  notify<number>(EVENT_NUM_VISITORS, num);
};

const useNumVisitors = () => {
  const initialNumVisitors = lastEvent<number>(EVENT_NUM_VISITORS) ?? 0;
  const [numVisitors, setNumVisitors_] = useState(initialNumVisitors);

  useEffect(() => {
    listen<number>(
      EVENT_NUM_VISITORS,
      (x) => {
        if(x !== undefined) {
          setNumVisitors_(x);
        }
      }
    );
  }, []);

  return numVisitors;
};

const setVisitorKeys = (sectionKey: SectionKey, visitorKeys: string[]) => {
  notify<string[]>(sectionKey, visitorKeys);
};

const setLastVisitedAt = (lastVisitedAt: string | null) => {
  notify<string | null>(EVENT_VISITORS_LAST_VISITED_AT, lastVisitedAt);
};

const useLastVisitedAt = (): string | null => {
  const initial = lastEvent<string>(EVENT_VISITORS_LAST_VISITED_AT) ?? null;

  const [lastVisitedAt, setLastVisitedAt] = useState(initial);

  useEffect(() => {
    return listen<string>(
      EVENT_VISITORS_LAST_VISITED_AT,
      (x) => {
        if (x === undefined) {
          return;
        }

        setLastVisitedAt(x);
      },
    );
  }, []);

  return lastVisitedAt;
};

const useVisitorKeys = (sectionKey: SectionKey): string[] | null => {
  const initial = lastEvent<string[]>(sectionKey) ?? null;

  const [visitorKeys, setVisitorKeys] = useState<string[] | null>(initial);

  useEffect(() => {
    return listen<string[]>(
      sectionKey,
      (newItem) => {
        if (!newItem) {
          return;
        }

        setVisitorKeys((prev) => _.isEqual(prev, newItem) ? prev : newItem);
      },
      true,
    );
  }, [sectionKey]);

  return visitorKeys;
};

const setVisitorDataItem = (
  key: string,
  dataItem: DataItem,
  ignoreEarlierVisit: boolean
) => {
  if (!ignoreEarlierVisit) {
    notify<DataItem>(key, dataItem);
    return;
  }

  // ISO 8601 UTC timestamps sort lexicographically; '' is older than any.
  const lastVisitTime = lastEvent<DataItem>(key)?.time ?? '';

  if (dataItem.time > lastVisitTime) {
    notify<DataItem>(key, dataItem);
  }
};

const useVisitorDataItem = (key: string): DataItem | null => {
  const [item, setItem] = useState<DataItem | null>(
    () => lastEvent<DataItem>(key) ?? null);

  useEffect(() => {
    return listen<DataItem>(
      key,
      (newItem) => {
        if (!newItem) {
          return;
        }

        setItem((prev) => _.isEqual(prev, newItem) ? prev : newItem);
      },
    );
  }, [key]);

  return item;
};

const emptyData = (): Data => ({
  visited_you: [],
  you_visited: [],
  last_visited_at: null,
});

let currentData: Data = emptyData();

const setData = (data: Data) => {
  currentData = data;

  for (let dataItem of data.visited_you) {
    setVisitorDataItem(`visited_you-${dataItem.person_uuid}`, dataItem, true);
  }

  for (let dataItem of data.you_visited) {
    setVisitorDataItem(`you_visited-${dataItem.person_uuid}`, dataItem, true);
  }

  setVisitorKeys('visited_you', sectionRowKeys('visited_you', data.visited_you));

  setVisitorKeys('you_visited', sectionRowKeys('you_visited', data.you_visited));

  setLastVisitedAt(data.last_visited_at);

  setNumVisitors(data.visited_you.filter(d => d.is_new).length);
};

const maxTimestamp = (
  a: string | null,
  b: string | null,
): string | null => {
  if (!a) return b;
  if (!b) return a;
  // ISO 8601 UTC timestamps sort lexicographically.
  return a > b ? a : b;
};

// Newest first, matching the server's ORDER BY updated_at DESC.
const byVisitTimeDesc = (a: DataItem, b: DataItem): number =>
  a.time > b.time ? -1 : a.time < b.time ? 1 : 0;

// Return a copy of `items` with `item`'s row content refreshed (timestamp,
// was_invisible, ...) if it's already present, or `item` added if it's new. The
// existing order is left untouched.
const mergeVisitor = (items: DataItem[], item: DataItem): DataItem[] =>
  items.some((d) => d.person_uuid === item.person_uuid)
    ? items.map((d) => d.person_uuid === item.person_uuid ? item : d)
    : [item, ...items];

// Return a copy of `items` ordered newest first.
const sortByRecency = (items: DataItem[]): DataItem[] =>
  [...items].sort(byVisitTimeDesc);

// person_uuids whose next `you_visited` delta should keep its current position
// instead of jumping to the top. Set when a profile is opened directly from the
// "You Visited" list (where the reorder would be disorienting on back-nav), and
// consumed by the matching delta.
const youVisitedReorderSuppressions = new Set<string>();

const suppressYouVisitedReorder = (personUuid: string) => {
  youVisitedReorderSuppressions.add(personUuid);
};

// Merge a single live visitor into the cached snapshot, then re-dispatch.
const applyVisitorDelta = (
  section: SectionKey,
  item: DataItem,
  lastVisitedAt: string | null,
) => {
  // The visited row's content is always refreshed (or inserted when new); only
  // the reorder to the front is suppressed. That happens for a `you_visited`
  // delta whose visit was started from the "You Visited" list itself, where
  // jumping to the top is disorienting on back-nav. `Set.delete` tests and
  // consumes the one-shot flag; the section guard stops a `visited_you` delta
  // from consuming a flag meant for the matching `you_visited` delta.
  const preserveOrder =
    section === 'you_visited' &&
    youVisitedReorderSuppressions.delete(item.person_uuid);

  const withVisit = mergeVisitor(currentData[section], item);
  const merged = preserveOrder ? withVisit : sortByRecency(withVisit);

  setData({
    ...currentData,
    [section]: merged,
    last_visited_at: maxTimestamp(
      maxTimestamp(currentData.last_visited_at, lastVisitedAt),
      item.time,
    ),
  });
};

const markVisitorsChecked = (time: string) => {
  send({ data: { duo_mark_visitors_checked: { '@when': time } } });
  setNumVisitors(0);
};

const markVisitorChecked = (personUuid: string) => {
  const key = `visited_you-${personUuid}`;

  const dataItem = lastEvent<DataItem>(key);

  if (!dataItem) {
    return;
  }

  const updated = { ...dataItem, is_new: false };

  // Keep the cached snapshot consistent so a later delta merge doesn't
  // re-light this visitor as "new".
  currentData = {
    ...currentData,
    visited_you: currentData.visited_you.map(
      (d) => d.person_uuid === personUuid ? updated : d),
  };

  setVisitorDataItem(key, updated, false);
};

const requestVisitorsSnapshot = async () => {
  // An open conversation's history loads first (see
  // `frontend/chat/conversation-priority`); resolves immediately outside of
  // connect time.
  await awaitFocusedConversationFetch();

  send({ data: { duo_query_visitors: null } });
};

const onReceive = (doc: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (doc?.duo_visitors !== undefined) {
    try {
      const parsed = JSON.parse(doc.duo_visitors);
      if (isValidData(parsed)) {
        setData(parsed);
      }
    } catch { }
    return;
  }

  if (doc?.duo_visitor !== undefined) {
    try {
      const section = doc.duo_visitor['@section'];
      const lastVisitedAt = doc.duo_visitor['@last_visited_at'] ?? null;
      const item = JSON.parse(doc.duo_visitor['#text']);

      if (
        (section === 'visited_you' || section === 'you_visited') &&
        isValidDataItem(item)
      ) {
        applyVisitorDelta(section, item, lastVisitedAt);
      }
    } catch { }
    return;
  }
};

listen<boolean>(
  'chat-is-online',
  (isOnline) => {
    if (isOnline) {
      requestVisitorsSnapshot();
    }
  },
  true,
);

listen(
  'signed-in-user',
  (user) => {
    if (!user) {
      youVisitedReorderSuppressions.clear();
      setData(emptyData());
    }
  },
);

listen(EV_CHAT_WS_RECEIVE, onReceive);

export {
  DataItem,
  SectionKey,
  markVisitorChecked,
  markVisitorsChecked,
  suppressYouVisitedReorder,
  useLastVisitedAt,
  useNumVisitors,
  useVisitorDataItem,
  useVisitorKeys,
};
