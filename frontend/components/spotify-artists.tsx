import {
  Linking,
  Pressable,
  StyleSheet,
  TextStyle,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import Svg, { Path } from 'react-native-svg';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DefaultText } from './default-text';
import { Title } from './title';
import { AppTheme, useAppTheme } from '../app-theme/app-theme';
import { themedSurface } from '../app-theme/surface';
import { SpotifyArtistItem } from '../api/spotify';

const spotifyIconPath = 'm83.996 0.277c-46.249 0-83.743 37.493-83.743 83.742 0 46.251 37.494 83.741 83.743 83.741 46.254 0 83.744-37.49 83.744-83.741 0-46.246-37.49-83.738-83.745-83.738l0.001-0.004zm38.404 120.78c-1.5 2.46-4.72 3.24-7.18 1.73-19.662-12.01-44.414-14.73-73.564-8.07-2.809 0.64-5.609-1.12-6.249-3.93-0.643-2.81 1.11-5.61 3.926-6.25 31.9-7.288 59.263-4.15 81.337 9.34 2.46 1.51 3.24 4.72 1.73 7.18zm10.25-22.802c-1.89 3.072-5.91 4.042-8.98 2.152-22.51-13.836-56.823-17.843-83.448-9.761-3.453 1.043-7.1-0.903-8.148-4.35-1.04-3.453 0.907-7.093 4.354-8.143 30.413-9.228 68.222-4.758 94.072 11.127 3.07 1.89 4.04 5.91 2.15 8.976v-0.001zm0.88-23.744c-26.99-16.031-71.52-17.505-97.289-9.684-4.138 1.255-8.514-1.081-9.768-5.219-1.254-4.14 1.08-8.513 5.221-9.771 29.581-8.98 78.756-7.245 109.83 11.202 3.73 2.209 4.95 7.016 2.74 10.733-2.2 3.722-7.02 4.949-10.73 2.739z';

const inkColor = (appTheme: AppTheme, color: unknown) =>
  typeof color === 'string' ? color : appTheme.secondaryColor;

const SpotifyIcon = ({ size, color }: { size: number, color: string }) => (
  <Svg width={size} height={size} viewBox="0 0 168 168">
    <Path fill={color} d={spotifyIconPath} />
  </Svg>
);

const SpotifyTitle = ({ color }: { color?: string }) => {
  const { appTheme } = useAppTheme();

  const ink = inkColor(appTheme, color);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 24,
        marginBottom: 8,
        width: '100%',
      }}
    >
      <SpotifyIcon size={21} color={ink} />
      <Title style={{ marginTop: 0, marginBottom: 0, color: ink }}>
        Top artists on Spotify
      </Title>
    </View>
  );
};

const SpotifyArtist = ({
  artist,
  textStyle,
}: {
  artist: SpotifyArtistItem,
  textStyle?: TextStyle,
}) => {
  const { appThemeName, appTheme } = useAppTheme();

  const color = StyleSheet.flatten(textStyle)?.color;

  const chrome = themedSurface(appThemeName, appTheme.surface, color);

  return (
    <Pressable
      onPress={() => Linking.openURL(
        `https://open.spotify.com/artist/${artist.spotify_id}`
      )}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        maxWidth: '100%',
        borderColor: chrome.borderColor,
        borderWidth: 1,
        borderRadius: 999,
        backgroundColor: chrome.backgroundColor,
        padding: 4,
        paddingRight: 12,
      }}
    >
      {artist.image_url ?
        <Image
          source={{ uri: artist.image_url }}
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
          }}
        />
      :
        <View
          style={{
            width: 28,
            height: 28,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons
            style={{
              fontSize: 16,
              color: inkColor(appTheme, color),
            }}
            name="musical-notes"
          />
        </View>
      }
      <DefaultText
        style={[
          {
            flexShrink: 1,
            fontSize: 13,
            fontWeight: '600',
          },
          textStyle,
        ]}
      >
        {artist.name}
      </DefaultText>
    </Pressable>
  );
};

const SpotifyArtists = ({
  artists,
  textStyle,
}: {
  artists: SpotifyArtistItem[],
  textStyle?: TextStyle,
}) => (
  <View
    style={{
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 7,
    }}
  >
    {artists.map((artist) =>
      <SpotifyArtist
        key={artist.spotify_id}
        artist={artist}
        textStyle={textStyle}
      />
    )}
  </View>
);

export {
  SpotifyArtists,
  SpotifyIcon,
  SpotifyTitle,
};
