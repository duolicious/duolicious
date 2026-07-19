import { StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

// Fills its parent, which every caller sizes to the image's aspect ratio, so
// `fill` matches `contain` without risking a sub-pixel letterbox down one
// edge.
const FillImage = ({
  uri,
  onLoad,
}: {
  uri: string
  onLoad?: () => void
}) => (
  <ExpoImage
    source={{ uri }}
    style={StyleSheet.absoluteFill}
    contentFit="fill"
    transition={0}
    cachePolicy="memory-disk"
    onLoad={onLoad}
  />
);

export {
  FillImage,
};
