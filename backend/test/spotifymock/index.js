const express = require('express');
const bodyParser = require('body-parser');

const PORT = process.env.PORT || 3003;

// Canned artists in Spotify's /v1/me/top/artists shape. Name lengths vary and
// one artist has no images so the frontend's wrapping and fallback art can be
// checked against the mock. Image URLs use localhost so a browser driving the
// dev stack can load them.
const images = (n) => [640, 320, 160].map((size) => ({
  url: `http://localhost:${PORT}/image/${n}-${size}.svg`,
  height: size,
  width: size,
}));

const defaultArtists = [
  { id: 'artist-id-1', name: 'Mock Artist One', images: images(1) },
  { id: 'artist-id-2', name: 'Mock Artist Two', images: images(2) },
  { id: 'artist-id-3', name: 'Mock Artist Three', images: images(3) },
  { id: 'artist-id-4', name: 'MA4', images: images(4) },
  { id: 'artist-id-5', name: 'The Mockingbirds', images: [] },
  {
    id: 'artist-id-6',
    name: 'DJ Mockingjay and the Fabricated Placeholder Philharmonic',
    images: images(6),
  },
  { id: 'artist-id-7', name: 'Stub & Sons', images: images(7) },
  {
    id: 'artist-id-8',
    name: 'An Unreasonably Verbose Ensemble Whose Name Should Wrap Rather Than Overflow the Screen',
    images: images(8),
  },
  { id: 'artist-id-9', name: 'Canned Heatless', images: images(9) },
  { id: 'artist-id-10', name: 'Fixture', images: images(10) },
  { id: 'artist-id-11', name: 'Placebo Domingo', images: images(11) },
  { id: 'artist-id-12', name: 'The Null Terminators', images: images(12) },
  {
    id: 'artist-id-13',
    name: 'Society for the Preservation of Extremely Roundabout and Deliberately Overlong Band Names',
    images: images(13),
  },
  { id: 'artist-id-14', name: 'Dummy & the Stand-Ins', images: images(14) },
  { id: 'artist-id-15', name: 'Lorem Ipsum Quartet', images: images(15) },
  {
    id: 'artist-id-16',
    name: 'Ersatz Brass Ensemble of the Greater Mockington Metropolitan Area and Surrounding Boroughs',
    images: images(16),
  },
  { id: 'artist-id-17', name: 'Faux Real', images: images(17) },
  { id: 'artist-id-18', name: 'Scaffold', images: images(18) },
  {
    id: 'artist-id-19',
    name: 'The Copy of a Copy of a Copy Orchestra',
    images: images(19),
  },
  {
    id: 'artist-id-20',
    name: 'Test Pattern feat. the Synthetic String Section',
    images: images(20),
  },
];

let artists = defaultArtists;
let revoked = false;
// Only the artists API rejects the caller; the token endpoint keeps working.
let unauthorizedApi = false;
let tokenCounter = 0;

// Like the real token endpoint, reject requests whose Basic auth doesn't
// carry the registered client credentials.
const expectedAuthorization =
  process.env.SPOTIFY_MOCK_CLIENT_ID && process.env.SPOTIFY_MOCK_CLIENT_SECRET
    ? 'Basic ' + Buffer.from(
        process.env.SPOTIFY_MOCK_CLIENT_ID +
        ':' +
        process.env.SPOTIFY_MOCK_CLIENT_SECRET
      ).toString('base64')
    : null;

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Approves instantly and bounces the browser back with a canned code.
app.get('/authorize', (req, res) => {
  const redirectUri = req.query.redirect_uri;
  const state = req.query.state;
  if (typeof redirectUri !== 'string' || !redirectUri) {
    res.status(400).send('missing redirect_uri');
    return;
  }
  const url = new URL(redirectUri);
  url.searchParams.set('code', 'mock-authorization-code');
  url.searchParams.set('state', typeof state === 'string' ? state : '');
  res.redirect(302, url.toString());
});

app.post('/api/token', (req, res) => {
  if (!expectedAuthorization ||
      req.headers.authorization !== expectedAuthorization) {
    res.status(400).json({
      error: 'invalid_client',
      error_description: 'Invalid client',
    });
    return;
  }

  if (revoked) {
    res.status(400).json({
      error: 'invalid_grant',
      error_description: 'Refresh token revoked',
    });
    return;
  }

  tokenCounter += 1;
  res.status(200).json({
    access_token: `mock-access-token-${tokenCounter}`,
    token_type: 'Bearer',
    scope: 'user-top-read',
    expires_in: 3600,
    refresh_token: `mock-refresh-token-${tokenCounter}`,
  });
});

app.get('/v1/me/top/artists', (req, res) => {
  if (revoked || unauthorizedApi) {
    res.status(401).json({
      error: { status: 401, message: 'The access token expired' },
    });
    return;
  }

  const limit = Number(req.query.limit);
  res.status(200).json({
    items: Number.isFinite(limit) ? artists.slice(0, limit) : artists,
  });
});

app.get('/image/:file', (req, res) => {
  const match = /^(\d+)-(\d+)\.svg$/.exec(req.params.file);
  if (!match) {
    res.status(404).send('not found');
    return;
  }
  const [, n, size] = match;
  const hue = (Number(n) * 137) % 360;
  res.set('Content-Type', 'image/svg+xml').status(200).send(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" fill="hsl(${hue}, 70%, 45%)"/>` +
    `<circle cx="50" cy="50" r="32" fill="hsl(${(hue + 40) % 360}, 70%, 65%)"/>` +
    `<text x="50" y="62" text-anchor="middle" font-family="sans-serif" font-size="34" font-weight="bold" fill="#fff">${n}</text>` +
    `</svg>`
  );
});

app.post('/control/revoked', (req, res) => {
  revoked = !!req.body.revoked;
  res.status(200).send();
});

app.post('/control/artists', (req, res) => {
  artists = req.body;
  res.status(200).send();
});

app.post('/control/unauthorized', (req, res) => {
  unauthorizedApi = !!req.body.unauthorized;
  res.status(200).send();
});

app.delete('/control', (req, res) => {
  artists = defaultArtists;
  revoked = false;
  unauthorizedApi = false;
  res.status(200).send();
});

app.listen(PORT, () => {
  console.log(`Spotify mock running on port ${PORT}`);
});
