import { memo, useCallback, useRef } from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';
import { Pressable } from './pressable';
import { PhotoOrSkeleton } from './profile-card';
import { VerificationBadge } from './verification-badge';
import * as _ from 'lodash';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootParamList } from '../navigation/linking';
import { Image as ExpoImage } from 'expo-image';
import { photoUri, videoUri } from '../util/photos';
import { AutoplayVideo, unmuteVideos } from './looping-video';
import type { PhotoGeometry } from '../util/photos';
import {
  ZERO_BORDER_RADII,
  setExpandedPhoto,
  usePhotoExpansion,
} from '../events/expanded-photo';
import type { AlbumPhoto, BorderRadii } from '../events/expanded-photo';
import { noSelect } from '../styles';

// This component owns the preview's corner rounding (rather than reading it
// back out of `style`) because the gallery animates the same radii while the
// photo expands. Corners a partial object omits are square.
const toBorderRadii = (
  borderRadius: number | Partial<BorderRadii> | undefined,
): BorderRadii =>
  typeof borderRadius === 'number'
    ? {
      topLeft: borderRadius,
      topRight: borderRadius,
      bottomLeft: borderRadius,
      bottomRight: borderRadius,
    }
    : {
      ...ZERO_BORDER_RADII,
      ...borderRadius,
    };

const EnlargeablePhoto = memo(({
  photoUuid,
  photoExtraExts,
  photoBlurhash,
  photoGeometry,
  album,
  borderRadius,
  style,
  innerStyle,
  isPrimary,
  isVerified = false,
  withControls = false,
}: {
  photoUuid: string | undefined | null
  photoExtraExts?: string[] | undefined | null
  photoBlurhash: string | undefined | null
  photoGeometry?: PhotoGeometry | undefined | null
  // Every photo of the same person, so the gallery can page between them. When
  // omitted (e.g. the feed), the tapped photo is the only one.
  album?: AlbumPhoto[] | undefined | null
  borderRadius?: number | Partial<BorderRadii>
  style?: StyleProp<ViewStyle>
  innerStyle?: StyleProp<ViewStyle>
  isPrimary: boolean
  isVerified?: boolean
  withControls?: boolean
}) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootParamList>>();
  const ref = useRef<View>(null);

  // The gallery draws this same photo over the top of this preview and expands
  // it, so the preview gets out of the way for as long as it's up.
  const expansion = usePhotoExpansion(photoUuid);

  const internalOnPress = useCallback(() => {
    if (!navigation) {
      return;
    }

    if (!photoUuid) {
      return;
    }

    if (videoUri(photoUuid, photoExtraExts)) {
      unmuteVideos();
    }

    const fullAlbum: AlbumPhoto[] =
      album && album.length
        ? album
        : [{
          uuid: photoUuid,
          extraExts: photoExtraExts ?? [],
          geometry: photoGeometry ?? null,
          blurhash: photoBlurhash ?? null,
        }];

    // Without a geometry there's nothing to uncrop the photo into, so the
    // gallery opens without the morph.
    if (!photoGeometry || !ref.current) {
      setExpandedPhoto({
        photoUuid,
        album: fullAlbum,
        morph: null,
        covered: false,
        closing: false,
      });
      return navigation.navigate('Gallery Screen', { photoUuid });
    }

    // Measured at press time because the preview scrolls; a zero-sized
    // measurement means there's nowhere to expand from.
    ref.current.measureInWindow((x, y, width, height) => {
      setExpandedPhoto({
        photoUuid,
        album: fullAlbum,
        morph: width > 0 && height > 0
          ? {
            from: { x, y, width, height },
            geometry: photoGeometry,
            borderRadius: toBorderRadii(borderRadius),
          }
          : null,
        covered: false,
        closing: false,
      });

      navigation.navigate('Gallery Screen', { photoUuid });
    });
  }, [photoUuid, photoExtraExts, photoBlurhash, photoGeometry, album, borderRadius, navigation]);

  const prefetchEnlargedImage = useCallback(() => {
    const enlargedUri = photoUri(photoUuid, 'original', photoExtraExts);
    const previewUri = photoUri(photoUuid, 900, photoExtraExts);
    if (!enlargedUri || enlargedUri === previewUri) return;
    setTimeout(() => {
      try {
        ExpoImage.prefetch(enlargedUri);
      } catch (e) {
        console.warn(e);
      }
    }, 500);
  }, [photoUuid, photoExtraExts]);

  if (photoUuid === undefined && !isPrimary) {
    return <></>;
  }

  const radii = toBorderRadii(borderRadius);

  const video = videoUri(photoUuid, photoExtraExts);

  return (
    <Pressable
      ref={ref}
      disabled={!photoUuid}
      onPress={internalOnPress}
      link={photoUuid ? { href: `/gallery/${photoUuid}` } : undefined}
      style={[
        {
          width: '100%',
          aspectRatio: 1,
          borderTopLeftRadius: radii.topLeft,
          borderTopRightRadius: radii.topRight,
          borderBottomLeftRadius: radii.bottomLeft,
          borderBottomRightRadius: radii.bottomRight,
          ...noSelect,
        },
        style,
        expansion === 'covered' || expansion === 'closing' ? { opacity: 0 } : null,
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
      {video &&
        <AutoplayVideo
          uri={video}
          withControls={withControls}
          surfaceHidden={expansion === 'covered'}
          opening={expansion === 'opening'}
        />
      }
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
});

export {
  EnlargeablePhoto,
}
