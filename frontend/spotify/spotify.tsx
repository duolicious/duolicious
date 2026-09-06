type SpotifyArtistItem = {
  spotify_id: string,
  name: string,
  image_url_small: string | null,
  image_url_large: string | null,
};

const spotifyArtistUrl = (artist: SpotifyArtistItem): string =>
  `https://open.spotify.com/artist/${artist.spotify_id}`;

export {
  SpotifyArtistItem,
  spotifyArtistUrl,
};
