import { useEffect, useState } from 'react';
import { Dimensions, ViewStyle } from 'react-native';
import { COLUMN_MAX_WIDTH } from '../../constants/constants';
import { isMobile } from '../../util/util';

const LEFT_PANE_MIN_WIDTH = 280;
const RIGHT_PANE_WIDTH = 360;

const LEFT_PANE_STYLE: ViewStyle = { flex: 1, minWidth: LEFT_PANE_MIN_WIDTH };
const CONTENT_COLUMN_STYLE: ViewStyle = { flex: 3, maxWidth: COLUMN_MAX_WIDTH };
const RIGHT_PANE_STYLE: ViewStyle = { flex: 1, minWidth: RIGHT_PANE_WIDTH };

const hasRightPane = (windowWidth: number): boolean =>
  !isMobile() &&
  windowWidth >= LEFT_PANE_MIN_WIDTH + COLUMN_MAX_WIDTH + RIGHT_PANE_WIDTH;

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
  RIGHT_PANE_WIDTH,
  hasRightPane,
  useHasRightPane,
  useWindowWidthCheck,
};
