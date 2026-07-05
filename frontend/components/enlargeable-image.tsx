import { useCallback } from 'react';
import { GestureResponderEvent, Pressable, StyleProp, ViewStyle } from 'react-native';
import { PhotoOrSkeleton } from './profile-card';
import { VerificationBadge } from './verification-badge';
import * as _ from 'lodash';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ProspectParamList } from '../navigation/linking';
import { Image as ExpoImage } from 'expo-image';
import { IMAGES_URL } from '../env/env';

const hasGifExtraExt = (photoExtraExts: string[] | undefined | null): boolean =>
  photoExtraExts?.some((ext) => ext.toLowerCase() === 'gif') ?? false;

const EnlargeablePhoto = ({
  photoUuid,
  photoExtraExts,
  photoBlurhash,
  style,
  innerStyle,
  isPrimary,
  isVerified = false,
  onPress,
}: {
  photoUuid: string | undefined | null
  photoExtraExts?: string[] | undefined | null
  photoBlurhash: string | undefined | null
  style?: StyleProp<ViewStyle>
  innerStyle?: StyleProp<ViewStyle>
  isPrimary: boolean
  isVerified?: boolean
  onPress?: () => void
}) => {
  const navigation = useNavigation<NativeStackNavigationProp<ProspectParamList>>();
  const isGif = hasGifExtraExt(photoExtraExts);

  const internalOnPress = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();

    if (!navigation) {
      return;
    }

    if (onPress) {
      return onPress();
    }

    if (photoUuid) {
      return navigation.navigate('Gallery Screen', { photoUuid });
    }
  }, [photoUuid]);


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
      disabled={isGif || !photoUuid}
      onPress={internalOnPress}
      style={[
        {
          width: '100%',
          aspectRatio: 1,
        },
        style,
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
