import {
  ActivityIndicator,
  ImageStyle,
  Pressable,
  StyleProp,
  View,
} from 'react-native';
import { LogoActivityIndicator } from './logo/logo-activity-indicator';
import {
  useState,
} from 'react';
import { DefaultText } from './default-text';
import { useImage, Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';

const AutoResizingGif = ({
  uri,
  onError,
  style,
  requirePress = false,
  priority,
  activityIndicator = 'logo',
}: {
  uri: string
  onError?: () => void
  style?: StyleProp<ImageStyle>,
  requirePress?: boolean
  priority?: null | 'low' | 'normal' | 'high'
  activityIndicator?: 'logo' | 'default'
}) => {
  const [shouldLoad, setShouldLoad] = useState(!requirePress);

  const image = useImage(
    shouldLoad ? uri : '',
    {
      onError: shouldLoad ? onError : () => {},
    }
  );

  if (!image) {
    return (
      <Pressable
        disabled={!requirePress}
        onPress={() => setShouldLoad(true)}
        style={{
          // The dimensions are chosen so the height of the placeholder will be
          // less than or equal to the rendered image. Otherwise
          // scroll-to-bottom will be broken in the case that the image loads
          // after the conversation screen already scrolled to the bottom.
          width: '100%',
          aspectRatio: 1,

          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          borderRadius: 10,
          gap: 12,
        }}
      >
        {requirePress &&
          <View
            style={{
              height: 70,
              width: 70,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {shouldLoad &&
              <LogoActivityIndicator size="large" color="white" />
            }
            {!shouldLoad &&
              <Ionicons
                style={{
                  flexShrink: 1,
                  fontSize: 60,
                  color: 'white',
                }}
                name="play-circle"
              />
            }
          </View>
        }
        {!requirePress && activityIndicator === 'logo' &&
          <LogoActivityIndicator size="large" color="white" />
        }
        {!requirePress && activityIndicator === 'default' &&
          <ActivityIndicator size="large" color="white" />
        }
        <DefaultText
          style={{
            fontSize: 22,
            fontWeight: 900,
            color: 'white',
          }}
        >
          GIF
        </DefaultText>
        {requirePress &&
          <DefaultText style={{ color: 'white' }}>
            Press to reveal
          </DefaultText>
        }
      </Pressable>
    );
  }

  return (
    <Image
      priority={priority}
      source={image}
      transition={150}
      style={[
        {
          width: '100%',
          aspectRatio: image.width / image.height,
          justifyContent: 'center',
          alignItems: 'center',
          borderRadius: 10,
          overflow: 'hidden',
        },
        style,
      ]}
    />
  );
};

export {
  AutoResizingGif,
};
