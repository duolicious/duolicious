import { Platform, StyleSheet, ViewStyle } from 'react-native';

const noSelect: ViewStyle & {
  userSelect?: 'none'
  WebkitUserSelect?: 'none'
  WebkitTouchCallout?: 'none'
  WebkitUserDrag?: 'none'
} = Platform.OS === 'web'
  ? {
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none',
    WebkitUserDrag: 'none',
  }
  : {};

const commonStyles = StyleSheet.create({
  primaryEnlargeablePhotoBigScreen: {
    overflow: 'hidden',
  },
  secondaryEnlargeablePhoto: {
    overflow: 'hidden',
    marginTop: 12,
    marginBottom: 12,
  },
  secondaryEnlargeablePhotoInner: {
  },
  cardBorders: {
    borderRadius: 10,

    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 3,
  },
});

export {
  commonStyles,
  noSelect,
};
