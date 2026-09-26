import {
  FlatList,
  FlatListProps,
  LayoutChangeEvent,
  ListRenderItem,
  ListRenderItemInfo,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { LogoActivityIndicator } from './logo/logo-activity-indicator';
import {
  ComponentType,
  ForwardedRef,
  Fragment,
  MutableRefObject,
  ReactElement,
  Ref,
  RefCallback,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DefaultText } from './default-text';
import { RenderedHoc } from './rendered-hoc';
import { FlashList, FlashListProps, FlashListRef } from '@shopify/flash-list';
import { useAppTheme } from '../app-theme/app-theme';
import { COLUMN_MAX_WIDTH } from '../constants/constants';
import * as _ from 'lodash';

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
  row: {
    flexDirection: 'row',
  },
});

type Page<ItemT> = ItemT[] | 'fetching'

type FetchPageError = {
  errorText?: string
};

type Book<ItemT> = {
  pages: Page<ItemT>[]
  isRefreshing: boolean
  error: FetchPageError | null
};

type Books<ItemT> = {
  [dataKey: string]: Book<ItemT>
};

const pageToItems = <ItemT,>(page: Page<ItemT>): ItemT[] =>
  page === 'fetching' ? [] : page;

const bookToItems = <ItemT,>(book: Book<ItemT>): ItemT[] =>
  book.error ? [] : book.pages.flatMap(pageToItems);

const isPageFetching = <ItemT,>(page: Page<ItemT>) =>
  page === 'fetching';

const isBookFetching = <ItemT,>(book: Book<ItemT>) =>
  book.pages.length > 0 && isPageFetching(book.pages[book.pages.length - 1]);

const isPageLast = <ItemT,>(page: Page<ItemT>) =>
  page.length === 0;

const isBookComplete = <ItemT,>(book: Book<ItemT>) =>
  book.error !== null ||
  book.pages.length > 0 && isPageLast(book.pages[book.pages.length - 1] ?? []);

const isBookEmpty = <ItemT,>(book: Book<ItemT>) =>
  bookToItems(book).length === 0;

const pageNumberToFetch = <ItemT,>(book: Book<ItemT>) =>
  book.pages.length + 1;

const setBookFetching = <ItemT,>(book: Book<ItemT>): void => {
  book.pages.push('fetching');
  book.isRefreshing = false;
  book.error = null;
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

const setBookError = <ItemT,>(
  book: Book<ItemT>,
  error: FetchPageError,
): void => {
  book.pages = [];
  book.isRefreshing = false;
  book.error = error;
};

const setBookRefreshing = <ItemT,>(book: Book<ItemT>): void => {
  book.pages = [];
  book.isRefreshing = true;
  book.error = null;
};

const getBookOrDefault = <ItemT,>(
  books: Books<ItemT>,
  dataKey: string
): Book<ItemT> =>
  books[dataKey] ?? { pages: [], isRefreshing: false, error: null };

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
  error: FetchPageError,
) => {
  books[dataKey] = getBookOrDefault(books, dataKey);
  setBookError(books[dataKey], error);
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
    FlatListProps<ItemT[]>,
    | "ListEmptyComponent"
    | "ListFooterComponent"
    | "data"
    | "keyExtractor"
    | "onRefresh"
    | "refreshing"
    | "renderItem"
  > & {
    renderItem: ListRenderItem<ItemT>,
    keyExtractor?: (item: ItemT, index: number) => string,
    emptyText?: string,
    errorText?: string,
    endText?: string,
    endTextStyle?: StyleProp<ViewStyle>,
    fetchPage: (pageNumber: number) => Promise<ItemT[] | FetchPageError | null>,
    hideListHeaderComponentWhenEmpty?: boolean,
    hideListHeaderComponentWhenLoading?: boolean,
    dataKey?: string,
    disableRefresh?: boolean,
    innerRef?: RefCallback<FlatList<ItemT[]>> | MutableRefObject<FlatList<ItemT[]> | null>,
  };

type DefaultFlashListProps<ItemT> =
  Omit<
    FlashListProps<ItemT> & {
      emptyText?: string,
      errorText?: string,
      endText?: string,
      endTextStyle?: StyleProp<ViewStyle>,
      fetchPage: (pageNumber: number) => Promise<ItemT[] | FetchPageError | null>,
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
  endText,
}: {
  isComplete: boolean,
  isEmpty: boolean,
  endText: string | undefined,
}) => {
  if (isComplete && isEmpty) {
    return <></>;
  } else if (isComplete && !isEmpty) {
    return <EndTextNotice endText={endText}/>;
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

const useList = <ItemT, ListType>(ref: Ref<{ refresh: () => Promise<void> }>, props: DefaultFlatListProps<ItemT> | DefaultFlashListProps<ItemT>) => {
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);

  const flatList = useRef<ListType | null>(null);

  const [books, setBooks] = useState<Books<ItemT>>({});

  const firstPageWaiters = useRef<(() => void)[]>([]);

  const resolveFirstPageWaiters = () =>
    firstPageWaiters.current.splice(0).forEach((resolve) => resolve());

  useEffect(() => resolveFirstPageWaiters, []);

  const dataKey = props.dataKey ?? 'default-key';

  const {
    fetchPage,
    onContentSizeChange: onContentSizeChangeProp,
    onLayout: onLayoutProp,
  } = props;

  const keyExtractor = useCallback((item: ItemT, index: number) => {
    return JSON.stringify({dataKey, index});
  }, [dataKey]);

  const fetchNextPage = useCallback(async () => {
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

    const page = await fetchPage(pageNumberToFetchVal);

    if (Array.isArray(page)) {
      setBookFetchedInBooks(books, page, dataKey, pageNumberToFetchVal - 1);
    } else {
      setBookErrorInBooks(books, dataKey, page ?? {});
    }

    setBooks(oldBooks => ({ ...oldBooks, ...books }));

    if (pageNumberToFetchVal === 1) {
      resolveFirstPageWaiters();
    }
  }, [books, dataKey, fetchPage]);

  const onRefresh = useCallback(() => {
    const firstPageLoaded = new Promise<void>((resolve) => {
      firstPageWaiters.current.push(resolve);
    });

    const book = getBookOrDefault(books, dataKey);

    if (book.isRefreshing) return firstPageLoaded;

    setBookRefreshingInBooks(books, dataKey);

    setBooks(oldBooks => ({ ...oldBooks, ...books }));

    fetchNextPage();

    return firstPageLoaded;
  }, [books, dataKey, fetchNextPage]);

  useImperativeHandle(ref, () => ({ refresh: onRefresh }), [onRefresh]);

  const onContentSizeChange = useCallback((width: number, height: number) => {
    contentHeight.current = height;

    if (contentHeight.current < viewportHeight.current) {
      fetchNextPage();
    }

    onContentSizeChangeProp?.(width, height);
  }, [fetchNextPage, onContentSizeChangeProp]);

  const onLayout = useCallback((params: LayoutChangeEvent) => {
    viewportHeight.current = params.nativeEvent.layout.height;

    if (contentHeight.current < viewportHeight.current) {
      fetchNextPage();
    }

    onLayoutProp?.(params);
  }, [fetchNextPage, onLayoutProp]);

  const book = getBookOrDefault(books, dataKey);
  const items = useMemo(
    () => bookToItems(getBookOrDefault(books, dataKey)),
    [books, dataKey]);

  const isComplete = isBookComplete(book);
  const isEmpty = isBookEmpty(book);
  const isLoading = isBookFetching(book);
  const isError = book.error !== null;
  const errorText = book.error?.errorText ?? props.errorText;

  const slots = useMemo(() => ({
    ListHeaderComponent:
      <ListHeaderComponent
        isEmpty={isEmpty}
        isLoading={isLoading}
        hideListHeaderComponentWhenEmpty={
          props.hideListHeaderComponentWhenEmpty ?? false
        }
        hideListHeaderComponentWhenLoading={
          props.hideListHeaderComponentWhenLoading ?? true
        }
        ListHeaderComponent={props.ListHeaderComponent}
      />,
    ListEmptyComponent:
      <ListEmptyComponent
        isComplete={isComplete}
        isError={isError}
        errorText={errorText}
        emptyText={props.emptyText} />,
    ListFooterComponent:
      <ListFooterComponent
        isComplete={isComplete}
        isEmpty={isEmpty}
        endText={props.endText} />,
  }), [
    isComplete,
    isEmpty,
    isError,
    isLoading,
    props.hideListHeaderComponentWhenEmpty,
    props.hideListHeaderComponentWhenLoading,
    props.ListHeaderComponent,
    errorText,
    props.emptyText,
    props.endText,
  ]);

  return {
    flatList,
    onRefresh,
    fetchNextPage,
    items,
    slots,
    onContentSizeChange,
    keyExtractor,
    onLayout,
  }
};

const UntypedDefaultFlatList = <ItemT,>(props: DefaultFlatListProps<ItemT>, ref: ForwardedRef<{ refresh: () => Promise<void> }>) => {
  const {
    flatList,
    onRefresh,
    fetchNextPage,
    items,
    slots,
    onContentSizeChange,
    keyExtractor,
    onLayout,
  } = useList<ItemT, FlatList<ItemT[]>>(ref, props);

  const {
    numColumns = 1,
    columnWrapperStyle,
    renderItem,
    keyExtractor: itemKeyExtractor = keyExtractor,
    ...listProps
  } = props;

  const data = useMemo(() => _.chunk(items, numColumns), [items, numColumns]);

  const renderRow = useCallback(
    ({ item: row, index, separators }: ListRenderItemInfo<ItemT[]>) =>
      numColumns === 1 ?
        renderItem({ item: row[0], index, separators }) :
        <View style={[styles.row, columnWrapperStyle]}>
          {row.map((item, i) =>
            <Fragment key={i}>
              {renderItem({ item, index: index * numColumns + i, separators })}
            </Fragment>
          )}
        </View>,
    [renderItem, numColumns, columnWrapperStyle]);

  const rowKeyExtractor = useCallback(
    (row: ItemT[], index: number) => itemKeyExtractor(row[0], index),
    [itemKeyExtractor]);

  const contentContainerStyle = useMemo(
    () => [styles.flatList, props.contentContainerStyle],
    [props.contentContainerStyle]);

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
      {...listProps}
      {...slots}
      data={data}
      renderItem={renderRow}
      contentContainerStyle={contentContainerStyle}
      onContentSizeChange={onContentSizeChange}
      keyExtractor={rowKeyExtractor}
      initialNumToRender={1}
      windowSize={5}
      onLayout={onLayout}
    />
  );
};

const UntypedDefaultFlashList = <ItemT,>(props: DefaultFlashListProps<ItemT>, ref: ForwardedRef<{ refresh: () => Promise<void> }>) => {
  const {
    flatList,
    onRefresh,
    fetchNextPage,
    items,
    slots,
    onContentSizeChange,
    keyExtractor,
    onLayout,
  } = useList<ItemT, FlashListRef<ItemT>>(ref, props);

  const contentContainerStyle = useMemo(() => ({
    ...styles.flatList,
    ...(props.contentContainerStyle as object | undefined),
  }), [props.contentContainerStyle]);

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
      {...props}
      {...slots}
      contentContainerStyle={contentContainerStyle}
      onContentSizeChange={onContentSizeChange}
      keyExtractor={props.keyExtractor ?? keyExtractor}
      onLayout={onLayout}
    />
  );
};

const TypedDefaultFlatList =
  forwardRef(UntypedDefaultFlatList) as <ItemT>(
    props: DefaultFlatListProps<ItemT> &
           React.RefAttributes<{ refresh: () => Promise<void> }>
  ) => React.ReactElement | null;

const TypedDefaultFlashList =
  forwardRef(UntypedDefaultFlashList) as <ItemT>(
    props: DefaultFlashListProps<ItemT> &
           React.RefAttributes<{ refresh: () => Promise<void> }>
  ) => React.ReactElement | null;

const DefaultFlatList =
  memo(TypedDefaultFlatList) as typeof TypedDefaultFlatList;

const DefaultFlashList =
  memo(TypedDefaultFlashList) as typeof TypedDefaultFlashList;

export {
  DefaultFlatList,
  DefaultFlashList,
  FetchPageError,
};
