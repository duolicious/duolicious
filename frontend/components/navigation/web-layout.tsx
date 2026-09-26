import { useEffect, useState } from 'react';
import { Dimensions, ViewStyle } from 'react-native';
import { COLUMN_MAX_WIDTH } from '../../constants/constants';
import { isMobile } from '../../util/util';

const RIGHT_PANE_MIN_WINDOW_WIDTH = 1100;

const LEFT_PANE_STYLE: ViewStyle = { flex: 1, minWidth: 280 };
const CONTENT_COLUMN_STYLE: ViewStyle = { flex: 3, maxWidth: COLUMN_MAX_WIDTH };
const RIGHT_PANE_STYLE: ViewStyle = { flex: 1 };

const hasRightPane = (windowWidth: number): boolean =>
  !isMobile() && windowWidth > RIGHT_PANE_MIN_WINDOW_WIDTH;

const useWindowWidthCheck = (check: (windowWidth: number) => boolean): boolean => {
  const result = check(Dimensions.get('window').width);
  const [, setResult] = useState(result);

  useEffect(() => {
    const subscription = Dimensions.addEventListener('change', ({ window }) =>
      setResult(check(window.width)));
    return () => subscription.remove();
  }, [check]);

  return result;
};

const useHasRightPane = (): boolean => useWindowWidthCheck(hasRightPane);

export {
  CONTENT_COLUMN_STYLE,
  LEFT_PANE_STYLE,
  RIGHT_PANE_STYLE,
  hasRightPane,
  useHasRightPane,
  useWindowWidthCheck,
};
