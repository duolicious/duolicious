import { useCallback, useRef } from 'react';
import { GestureResponderEvent, Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { PhotoOrSkeleton } from './profile-card';
import { VerificationBadge } from './verification-badge';
import * as _ from 'lodash';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootParamList } from '../navigation/linking';
import { Image as ExpoImage } from 'expo-image';
import { IMAGES_URL } from '../env/env';
import { hasGifExtraExt } from '../util/photos';
import type { PhotoGeometry } from '../util/photos';
import { setExpandedPhoto, useIsPhotoExpanded } from '../events/expanded-photo';

const EnlargeablePhoto = ({
  photoUuid,
  photoExtraExts,
  photoBlurhash,
  photoGeometry,
  style,
  innerStyle,
  isPrimary,
  isVerified = false,
}: {
  photoUuid: string | undefined | null
  photoExtraExts?: string[] | undefined | null
  photoBlurhash: string | undefined | null
  photoGeometry?: PhotoGeometry | undefined | null
  style?: StyleProp<ViewStyle>
  innerStyle?: StyleProp<ViewStyle>
  isPrimary: boolean
  isVerified?: boolean
}) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootParamList>>();
  const isGif = hasGifExtraExt(photoExtraExts);
  const ref = useRef<View>(null);

  // The gallery draws this same photo over the top of this preview and expands
  // it, so the preview gets out of the way for as long as it's up.
  const isExpanded = useIsPhotoExpanded(photoUuid);

  const internalOnPress = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();

    if (!navigation) {
      return;
    }

    if (!photoUuid) {
      return;
    }

    // Without a geometry there's nothing to uncrop the photo into, so the
    // gallery just fades up instead. Measuring is what tells it where to
    // expand from, and it can't be done from the layout alone: the preview
    // scrolls, so only its position at the moment of the press will do.
    if (!photoGeometry || !ref.current) {
      return navigation.navigate('Gallery Screen', { photoUuid });
    }

    ref.current.measureInWindow((x, y, width, height) => {
      // A zero-sized measurement means the preview isn't laid out where we can
      // expand from - fall back rather than animate out of nothing.
      if (width > 0 && height > 0) {
        setExpandedPhoto({
          photoUuid,
          from: { x, y, width, height },
          geometry: photoGeometry,
          covered: false,
        });
      }

      navigation.navigate('Gallery Screen', { photoUuid });
    });
  }, [photoUuid, photoGeometry, navigation]);

  const prefetchEnlargedImage = useCallback(() => {
    if (!photoUuid || isGif) return;
    const originalUri = `${IMAGES_URL}/original-${photoUuid}.jpg`;
    setTimeout(() => {
      try {
        ExpoImage.prefetch(originalUri);
      } catch (e) {
        console.warn(e);
      }
    }, 500);
  }, [photoUuid, isGif]);

  if (photoUuid === undefined && !isPrimary) {
    return <></>;
  }

  return (
    <Pressable
      ref={ref}
      disabled={isGif || !photoUuid}
      onPress={internalOnPress}
      style={[
        {
          width: '100%',
          aspectRatio: 1,
        },
        style,
        isExpanded ? { opacity: 0 } : null,
      ]}
    >
      <PhotoOrSkeleton
        resolution={900}
        photoExtraExts={photoExtraExts}
        photoUuid={photoUuid}
        photoBlurhash={photoBlurhash}
        showGradient={false}
        style={innerStyle}
        forceExpoImage={true}
        onLoad={prefetchEnlargedImage}
      />
      {isVerified &&
        <VerificationBadge
          style={{
            position: 'absolute',
            top: 18,
            right: 18,
          }}
          size={28}
        />
      }
    </Pressable>
  );
};

export {
  EnlargeablePhoto,
}
