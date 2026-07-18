import {
  FlatList,
  FlatListProps,
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { LogoActivityIndicator } from './logo/logo-activity-indicator';
import {
  ComponentType,
  ForwardedRef,
  MutableRefObject,
  ReactElement,
  Ref,
  RefCallback,
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { DefaultText } from './default-text';
import { RenderedHoc } from './rendered-hoc';
import { FlashList, FlashListProps, FlashListRef } from '@shopify/flash-list';
import { useAppTheme } from '../app-theme/app-theme';
import { COLUMN_MAX_WIDTH } from '../constants/constants';

const styles = StyleSheet.create({
  activityIndicator: {
    marginTop: 20,
    marginBottom: 20,
    alignItems: 'center',
  },
  errorText: {
    fontFamily: 'Trueno',
    margin: '20%',
    textAlign: 'center'
  },
  emptyText: {
    fontFamily: 'Trueno',
    margin: '20%',
    textAlign: 'center'
  },
  endText: {
    fontFamily: 'TruenoBold',
    fontSize: 16,
    textAlign: 'center',
    alignSelf: 'center',
    marginTop: 30,
    marginBottom: 30,
    marginLeft: '15%',
    marginRight: '15%',
  },
  flatList: {
    paddingTop: 10,
    alignItems: 'stretch',
    width: '100%',
    maxWidth: COLUMN_MAX_WIDTH,
    alignSelf: 'center',
  },
});

type Page<ItemT> = ItemT[] | 'fetching'

type Book<ItemT> = {
  pages: Page<ItemT>[]
  isRefreshing: boolean
  isError: boolean
};

type Books<ItemT> = {
  [dataKey: string]: Book<ItemT>
};

const pageToItems = <ItemT,>(page: Page<ItemT>): ItemT[] =>
  page === 'fetching' ? [] : page;

const bookToItems = <ItemT,>(book: Book<ItemT>): ItemT[] =>
  book.isError ? [] : book.pages.flatMap(pageToItems);

const isPageFetching = <ItemT,>(page: Page<ItemT>) =>
  page === 'fetching';

const isBookFetching = <ItemT,>(book: Book<ItemT>) =>
  book.pages.length > 0 && isPageFetching(book.pages[book.pages.length - 1]);

const isPageLast = <ItemT,>(page: Page<ItemT>) =>
  page.length === 0;

const isBookComplete = <ItemT,>(book: Book<ItemT>) =>
  book.isError ||
  book.pages.length > 0 && isPageLast(book.pages[book.pages.length - 1] ?? []);

const isBookEmpty = <ItemT,>(book: Book<ItemT>) =>
  bookToItems(book).length === 0;

const pageNumberToFetch = <ItemT,>(book: Book<ItemT>) =>
  book.pages.length + 1;

const setBookFetching = <ItemT,>(book: Book<ItemT>): void => {
  book.pages.push('fetching');
  book.isRefreshing = false;
  book.isError = false;
};

const setBookFetched = <ItemT,>(
  book: Book<ItemT>,
  page: Page<ItemT>,
  index: number,
): void => {
  if (index < 0 || index > book.pages.length - 1) {
    return;
  }

  book.pages[index] = page;
};

const setBookError = <ItemT,>(book: Book<ItemT>): void => {
  book.pages = [];
  book.isRefreshing = false;
  book.isError = true;
};

const setBookRefreshing = <ItemT,>(book: Book<ItemT>): void => {
  book.pages = [];
  book.isRefreshing = true;
  book.isError = false;
};

const getBookOrDefault = <ItemT,>(
  books: Books<ItemT>,
  dataKey: string
): Book<ItemT> =>
  books[dataKey] ?? { pages: [], isRefreshing: false, isError: false };

const setBookFetchingInBooks = <ItemT,>(
  books: Books<ItemT>,
  dataKey: string,
) => {
  // It's important to perform the update in-place so that `fetchNextPage`
  // can start blocking concurrent `fetchPage` attempts before the next render.
  books[dataKey] = getBookOrDefault(books, dataKey);
  setBookFetching(books[dataKey]);
};

const setBookFetchedInBooks = <ItemT,>(
  books: Books<ItemT>,
  page: Page<ItemT>,
  dataKey: string,
  index: number,
) => {
  books[dataKey] = getBookOrDefault(books, dataKey);
  setBookFetched(books[dataKey], page, index);
};

const setBookErrorInBooks = <ItemT,>(
  books: Books<ItemT>,
  dataKey: string,
) => {
  books[dataKey] = getBookOrDefault(books, dataKey);
  setBookError(books[dataKey]);
};

const setBookRefreshingInBooks = <ItemT,>(
  books: Books<ItemT>,
  dataKey: string,
) => {
  books[dataKey] = getBookOrDefault(books, dataKey);
  setBookRefreshing(books[dataKey]);
};

type DefaultFlatListProps<ItemT> =
  Omit<
    FlatListProps<ItemT> & {
      emptyText?: string,
      errorText?: string,
      endText?: string,
      endTextStyle?: StyleProp<ViewStyle>,
      fetchPage: (pageNumber: number) => Promise<ItemT[] | null>,
      hideListHeaderComponentWhenEmpty?: boolean,
      hideListHeaderComponentWhenLoading?: boolean,
      dataKey?: string,
      disableRefresh?: boolean,
      innerRef?: RefCallback<FlatList<ItemT>> | MutableRefObject<FlatList<ItemT> | null>,
    },
    | "ListEmptyComponent"
    | "ListFooterComponent"
    | "data"
    | "onRefresh"
    | "refreshing"
  >;

type DefaultFlashListProps<ItemT> =
  Omit<
    FlashListProps<ItemT> & {
      emptyText?: string,
      errorText?: string,
      endText?: string,
      endTextStyle?: StyleProp<ViewStyle>,
      fetchPage: (pageNumber: number) => Promise<ItemT[] | null>,
      hideListHeaderComponentWhenEmpty?: boolean,
      hideListHeaderComponentWhenLoading?: boolean,
      dataKey?: string,
      disableRefresh?: boolean,
      innerRef?: RefCallback<FlashListRef<ItemT>> | MutableRefObject<FlashListRef<ItemT> | null>,
    },
    | "ListEmptyComponent"
    | "ListFooterComponent"
    | "data"
    | "onRefresh"
    | "refreshing"
  >;

const LoadingIndicator = memo(() => {
  const { appTheme } = useAppTheme();

  return (
    <View style={styles.activityIndicator}>
      <LogoActivityIndicator size="large" color={appTheme.brandColor} />
    </View>
  );
});

const ListHeaderComponent = memo(({
  isEmpty,
  isLoading,
  hideListHeaderComponentWhenEmpty,
  hideListHeaderComponentWhenLoading,
  ListHeaderComponent,
}: {
  isEmpty: boolean,
  isLoading: boolean,
  hideListHeaderComponentWhenEmpty: boolean,
  hideListHeaderComponentWhenLoading: boolean,
  ListHeaderComponent: ComponentType | ReactElement | null | undefined,
}) => {
  if (isEmpty && isLoading && hideListHeaderComponentWhenLoading) {
    return <></>;
  } else if (isEmpty && hideListHeaderComponentWhenEmpty) {
    return <></>;
  } else {
    return <RenderedHoc Hoc={ListHeaderComponent}/>;
  }
});

const ListEmptyComponent = memo(({
  isComplete,
  isError,
  emptyText,
  errorText,
}: {
  isComplete: boolean
  isError: boolean
  emptyText: string | null | undefined
  errorText: string | null | undefined
}) => {
  if (isError) {
    return (
      <DefaultText style={styles.errorText}>
        {errorText ? errorText : "Something went wrong"}
      </DefaultText>
    );
  } else if (!isComplete) {
    return <></>;
  } else {
    return (
      <DefaultText style={styles.emptyText}>
        {emptyText}
      </DefaultText>
    );
  }
});

const ListFooterComponent = memo(({
  isComplete,
  isEmpty,
  EndTextNotice,
}: {
  isComplete: boolean,
  isEmpty: boolean,
  EndTextNotice: ComponentType | ReactElement | null | undefined,
}) => {
  if (isComplete && isEmpty) {
    return <></>;
  } else if (isComplete && !isEmpty) {
    return <RenderedHoc Hoc={EndTextNotice}/>;
  } else {
    return <LoadingIndicator/>;
  }
});

const EndTextNotice = ({
  endText
}: {
  endText: string | undefined
}) => {
  const { appTheme } = useAppTheme();

  if (endText) {
    return (
      <DefaultText style={[{ color: appTheme.secondaryColor }, styles.endText]}>
        {endText}
      </DefaultText>
    );
  } else {
    return <></>;
  }
};

const useList = <ItemT, ListType>(ref: Ref<{ refresh: () => void }>, props: DefaultFlatListProps<ItemT> | DefaultFlashListProps<ItemT>) => {
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);

  const flatList = useRef<ListType | null>(null);

  const [books, setBooks] = useState<Books<ItemT>>({});

  const dataKey = props.dataKey ?? 'default-key';

  const keyExtractor = useCallback((item: ItemT, index: number) => {
    return JSON.stringify({dataKey, index});
  }, [dataKey]);

  const fetchNextPage = async () => {
    if (viewportHeight.current < 1e-3) {
      // FlashList seems to be calling `onEndReached` repeatedly when occluded
      return;
    }

    const book = getBookOrDefault(books, dataKey);

    if (isBookComplete(book)) {
      return;
    }
    if (isBookFetching(book)) {
      return;
    }

    const pageNumberToFetchVal = pageNumberToFetch(book);

    setBookFetchingInBooks(books, dataKey);

    const page = await props.fetchPage(pageNumberToFetchVal);

    if (page === null) {
      setBookErrorInBooks(books, dataKey);
    } else {
      setBookFetchedInBooks(books, page, dataKey, pageNumberToFetchVal - 1);
    }

    setBooks(oldBooks => ({ ...oldBooks, ...books }));
  };

  const onRefresh = () => {
    const book = getBookOrDefault(books, dataKey);

    if (book.isRefreshing) return;

    setBookRefreshingInBooks(books, dataKey);

    setBooks(oldBooks => ({ ...oldBooks, ...books }));

    fetchNextPage();
  };

  useImperativeHandle(ref, () => ({ refresh: onRefresh }), [onRefresh]);

  const onContentSizeChange = (width: number, height: number) => {
    contentHeight.current = height;

    if (contentHeight.current < viewportHeight.current) {
      fetchNextPage();
    }

    if (props.onContentSizeChange) {
      props.onContentSizeChange(width, height);
    }
  };

  const onLayout = useCallback((params: LayoutChangeEvent) => {
    viewportHeight.current = params.nativeEvent.layout.height;

    if (contentHeight.current < viewportHeight.current) {
      fetchNextPage();
    }

    if (props.onLayout) {
      props.onLayout(params);
    }
  }, []);

  const book = getBookOrDefault(books, dataKey);
  const items = bookToItems(book);

  return {
    flatList,
    onRefresh,
    fetchNextPage,
    items,
    book,
    onContentSizeChange,
    keyExtractor,
    onLayout,
  }
};

const UntypedDefaultFlatList = <ItemT,>(props: DefaultFlatListProps<ItemT>, ref: ForwardedRef<{ refresh: () => void }>) => {
  const {
    flatList,
    onRefresh,
    fetchNextPage,
    items,
    book,
    onContentSizeChange,
    keyExtractor,
    onLayout,
  } = useList<ItemT, FlatList<ItemT>>(ref, props);

  return (
    <FlatList
      ref={(node) => {
        flatList.current = node;

        if (props.innerRef === undefined) {
          ;
        } else if (typeof props.innerRef === 'function') {
          props.innerRef(node);
        } else {
          props.innerRef.current = node;
        }
      }}
      refreshing={false}
      onRefresh={props.disableRefresh ? undefined : onRefresh}
      onEndReachedThreshold={props.onEndReachedThreshold ?? 3}
      onEndReached={fetchNextPage}
      data={items}
      ListEmptyComponent={
        <ListEmptyComponent
          isComplete={isBookComplete(book)}
          isError={book.isError}
          errorText={props.errorText}
          emptyText={props.emptyText} />
      }
      ListFooterComponent={
        <ListFooterComponent
          isComplete={isBookComplete(book)}
          isEmpty={isBookEmpty(book)}
          EndTextNotice={<EndTextNotice endText={props.endText} />}
        />
      }
      {...props}
      contentContainerStyle={[
        styles.flatList,
        props.contentContainerStyle,
      ]}
      ListHeaderComponent={
        <ListHeaderComponent
            isEmpty={isBookEmpty(book)}
            isLoading={isBookFetching(book)}
            hideListHeaderComponentWhenEmpty={
              props.hideListHeaderComponentWhenEmpty ?? false
            }
            hideListHeaderComponentWhenLoading={
              props.hideListHeaderComponentWhenLoading ?? true
            }
            ListHeaderComponent={props.ListHeaderComponent}
        />
      }
      onContentSizeChange={onContentSizeChange}
      keyExtractor={props.keyExtractor ?? keyExtractor}
      initialNumToRender={1}
      windowSize={5}
      onLayout={onLayout}
    />
  );
};

const UntypedDefaultFlashList = <ItemT,>(props: DefaultFlashListProps<ItemT>, ref: ForwardedRef<{ refresh: () => void }>) => {
  const {
    flatList,
    onRefresh,
    fetchNextPage,
    items,
    book,
    onContentSizeChange,
    keyExtractor,
    onLayout,
  } = useList<ItemT, FlashListRef<ItemT>>(ref, props);

  return (
    <FlashList
      ref={(node) => {
        flatList.current = node;

        if (props.innerRef === undefined) {
          ;
        } else if (typeof props.innerRef === 'function') {
          props.innerRef(node);
        } else {
          props.innerRef.current = node;
        }
      }}
      refreshing={false}
      onRefresh={props.disableRefresh ? undefined : onRefresh}
      onEndReachedThreshold={props.onEndReachedThreshold ?? 3}
      onEndReached={fetchNextPage}
      data={items}
      ListEmptyComponent={
        <ListEmptyComponent
          isComplete={isBookComplete(book)}
          isError={book.isError}
          errorText={props.errorText}
          emptyText={props.emptyText} />
      }
      ListFooterComponent={
        <ListFooterComponent
          isComplete={isBookComplete(book)}
          isEmpty={isBookEmpty(book)}
          EndTextNotice={<EndTextNotice endText={props.endText} />}
        />
      }
      {...props}
      contentContainerStyle={{
        ...styles.flatList,
        ...(props.contentContainerStyle as object | undefined),
      }}
      ListHeaderComponent={
        <ListHeaderComponent
            isEmpty={isBookEmpty(book)}
            isLoading={isBookFetching(book)}
            hideListHeaderComponentWhenEmpty={
              props.hideListHeaderComponentWhenEmpty ?? false
            }
            hideListHeaderComponentWhenLoading={
              props.hideListHeaderComponentWhenLoading ?? true
            }
            ListHeaderComponent={props.ListHeaderComponent}
        />
      }
      onContentSizeChange={onContentSizeChange}
      keyExtractor={props.keyExtractor ?? keyExtractor}
      onLayout={onLayout}
    />
  );
};

const TypedDefaultFlatList =
  forwardRef(UntypedDefaultFlatList) as <ItemT>(
    props: DefaultFlatListProps<ItemT> &
           React.RefAttributes<{ refresh: () => void }>
  ) => React.ReactElement | null;

const TypedDefaultFlashList =
  forwardRef(UntypedDefaultFlashList) as <ItemT>(
    props: DefaultFlashListProps<ItemT> &
           React.RefAttributes<{ refresh: () => void }>
  ) => React.ReactElement | null;

const DefaultFlatList =
  memo(TypedDefaultFlatList) as typeof TypedDefaultFlatList;

const DefaultFlashList =
  memo(TypedDefaultFlashList) as typeof TypedDefaultFlashList;

export {
  DefaultFlatList,
  DefaultFlashList,
};
