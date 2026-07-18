import { StyleSheet } from 'react-native';

// The photo styles carry no corner radii: EnlargeablePhoto rounds itself via
// its `borderRadius` prop, which the gallery also animates.
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
};
