import { ViewStyle } from 'react-native';
import { COLUMN_MAX_WIDTH } from '../../constants/constants';

const RIGHT_PANE_MIN_WINDOW_WIDTH = 1100;

const LEFT_PANE_STYLE: ViewStyle = { flex: 1, minWidth: 280 };
const CONTENT_COLUMN_STYLE: ViewStyle = { flex: 3, maxWidth: COLUMN_MAX_WIDTH };
const RIGHT_PANE_STYLE: ViewStyle = { flex: 1 };

const hasRightPane = (windowWidth: number): boolean =>
  windowWidth > RIGHT_PANE_MIN_WINDOW_WIDTH;

export {
  CONTENT_COLUMN_STYLE,
  LEFT_PANE_STYLE,
  RIGHT_PANE_STYLE,
  hasRightPane,
};
