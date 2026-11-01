import { describe, expect, jest, test } from '@jest/globals';
import { createRef } from 'react';
import { FlatList, Text } from 'react-native';
import { DefaultFlatList } from './default-flat-list';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

jest.mock('./logo/logo-activity-indicator', () => ({
  LogoActivityIndicator: () => null,
}));

type Renderer = ReturnType<typeof create>;

const renderList = (pages: string[][][], fetchAheadScreens?: number) => {
  let generation = -1;
  const fetchPage = async (pageNumber: number) => {
    if (pageNumber === 1) generation++;
    return pages[generation]?.[pageNumber - 1] ?? [];
  };

  const ref = createRef<{ refresh: () => Promise<void> }>();
  let renderer: Renderer;

  act(() => {
    renderer = create(
      <DefaultFlatList<string>
        ref={ref}
        fetchPage={fetchPage}
        fetchAheadScreens={fetchAheadScreens}
        renderItem={({ item }) => <Text>{item}</Text>}
      />
    );
  });

  return { renderer: renderer!, ref };
};

const flatList = (renderer: Renderer) =>
  renderer.root.findByType(FlatList).props;

const shownItems = (renderer: Renderer): string[] =>
  flatList(renderer).data.flat();

const layOut = async (renderer: Renderer) => {
  await act(async () => {
    flatList(renderer).onLayout({ nativeEvent: { layout: { height: 500 } } });
  });
};

describe('DefaultFlatList', () => {
  test('shows the next page', async () => {
    const { renderer } = renderList([[['a', 'b'], ['c']]]);

    await layOut(renderer);
    expect(shownItems(renderer)).toEqual(['a', 'b']);

    await act(async () => { await flatList(renderer).onEndReached(); });
    expect(shownItems(renderer)).toEqual(['a', 'b', 'c']);
  });

  test('fetches ahead from the last visible row', async () => {
    const { renderer } = renderList([[['a', 'b', 'c'], ['d']]], 1);

    await layOut(renderer);
    expect(flatList(renderer).onEndReached).toBeUndefined();

    await act(async () => {
      await flatList(renderer).onViewableItemsChanged({
        viewableItems: [{ index: 0 }],
      });
    });
    expect(shownItems(renderer)).toEqual(['a', 'b', 'c']);

    await act(async () => {
      await flatList(renderer).onViewableItemsChanged({
        viewableItems: [{ index: 2 }],
      });
    });
    expect(shownItems(renderer)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('shows refreshed results', async () => {
    const { renderer, ref } = renderList([[['a', 'b']], [['c']]]);

    await layOut(renderer);
    expect(shownItems(renderer)).toEqual(['a', 'b']);

    await act(async () => { await ref.current?.refresh(); });
    expect(shownItems(renderer)).toEqual(['c']);
  });
});
