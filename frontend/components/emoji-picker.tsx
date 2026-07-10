import { memo, useCallback, useMemo } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { DefaultText } from './default-text';
import { useAppTheme } from '../app-theme/app-theme';
import {
  EmojiEntry,
  getAllEmojis,
  getEmojiSections,
  searchEmojis,
} from '../util/emoji-index';

const COLUMNS = 8;

type GridItem =
  | { type: 'header', key: string, title: string }
  | { type: 'row', key: string, emojis: EmojiEntry[] };

const chunkIntoRows = (
  emojis: EmojiEntry[],
  keyPrefix: string,
): GridItem[] => {
  const rows: GridItem[] = [];

  for (let i = 0; i < emojis.length; i += COLUMNS) {
    rows.push({
      type: 'row',
      key: `${keyPrefix}-${i}`,
      emojis: emojis.slice(i, i + COLUMNS),
    });
  }

  return rows;
};

const SectionHeader = ({ title }: { title: string }) => {
  const { appTheme } = useAppTheme();

  return (
    <DefaultText
      style={{
        fontWeight: '700',
        color: appTheme.secondaryColor,
        paddingVertical: 8,
        paddingHorizontal: 4,
      }}
    >
      {title}
    </DefaultText>
  );
};

const EmojiRow = memo(({
  emojis,
  selected,
  onPick,
}: {
  emojis: EmojiEntry[]
  selected: string | undefined
  onPick: (native: string) => void
}) => {
  const { appTheme } = useAppTheme();

  return (
    <View style={{ flexDirection: 'row' }}>
      {emojis.map((emoji) =>
        <Pressable
          key={emoji.id}
          onPress={() => onPick(emoji.native)}
          style={{
            flex: 1,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            backgroundColor:
              selected === emoji.native
                ? appTheme.reactionSelectedBackgroundColor
                : 'transparent',
            ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {}),
          }}
        >
          <DefaultText style={{ fontSize: 26 }}>{emoji.native}</DefaultText>
        </Pressable>
      )}
      {Array.from({ length: COLUMNS - emojis.length }).map((_, i) =>
        <View key={i} style={{ flex: 1 }} />
      )}
    </View>
  );
});

const EmojiGrid = ({
  query,
  selected,
  onPick,
}: {
  query: string
  selected: string | undefined
  onPick: (native: string) => void
}) => {
  const { appTheme } = useAppTheme();

  const items = useMemo<GridItem[]>(() => {
    const trimmed = query.trim();

    if (trimmed) {
      return chunkIntoRows(searchEmojis(trimmed, getAllEmojis()), 'search');
    }

    return getEmojiSections().flatMap((section) => [
      {
        type: 'header' as const,
        key: `header-${section.id}`,
        title: section.title,
      },
      ...chunkIntoRows(section.emojis, section.id),
    ]);
  }, [query]);

  const renderItem = useCallback(({ item }: { item: GridItem }) => {
    if (item.type === 'header') {
      return <SectionHeader title={item.title} />;
    }

    return (
      <EmojiRow
        emojis={item.emojis}
        selected={
          item.emojis.some((emoji) => emoji.native === selected)
            ? selected
            : undefined
        }
        onPick={onPick}
      />
    );
  }, [selected, onPick]);

  if (!items.length) {
    return (
      <DefaultText
        style={{
          color: appTheme.secondaryColor,
          textAlign: 'center',
          paddingVertical: 20,
        }}
      >
        No emojis found
      </DefaultText>
    );
  }

  return (
    <View style={{ flex: 1, paddingHorizontal: 10 }}>
      {Platform.OS === 'web' ?
        <FlatList
          style={{ flex: 1 }}
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.key}
          keyboardShouldPersistTaps="handled"
        /> :
        <FlashList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.key}
          getItemType={(item) => item.type}
          keyboardShouldPersistTaps="handled"
        />
      }
    </View>
  );
};

export {
  EmojiGrid,
};
