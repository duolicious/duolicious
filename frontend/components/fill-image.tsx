import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

// Fills its parent, which every caller sizes to the image's aspect ratio, so
// `fill` matches `contain` without risking a sub-pixel letterbox down one
// edge.
const FillImage = ({
  uri,
  blurhash,
  onLoad,
}: {
  uri: string
  blurhash?: string | null
  onLoad?: () => void
}) => {
  const isLoaded = useRef(false);
  const [showBlurhash, setShowBlurhash] = useState(false);

  useEffect(() => {
    if (!blurhash) return;
    const timeout = setTimeout(() => {
      if (!isLoaded.current) setShowBlurhash(true);
    }, 200);
    return () => clearTimeout(timeout);
  }, [blurhash]);

  const internalOnLoad = useCallback(() => {
    isLoaded.current = true;
    onLoad?.();
  }, [onLoad]);

  return (
    <ExpoImage
      source={{ uri }}
      style={StyleSheet.absoluteFill}
      contentFit="fill"
      placeholder={showBlurhash && blurhash ? { blurhash } : undefined}
      placeholderContentFit="fill"
      transition={0}
      cachePolicy="memory-disk"
      draggable={false}
      onLoad={internalOnLoad}
    />
  );
};

export {
  FillImage,
};
