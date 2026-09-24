const crypto = require('crypto');
const express = require('express');

const PORT = process.env.PORT || 3005;

const expectedAuthorization = 'Basic ' + Buffer.from(
  process.env.DISCORD_MOCK_CLIENT_ID + ':' + process.env.DISCORD_MOCK_CLIENT_SECRET
).toString('base64');

const defaultUser = {
  id: '80351110224678912',
  username: 'mockuser',
  email: 'discord-user@example.com',
  verified: true,
};

let user = defaultUser;
let grants = {};
let accessTokens = {};
let counter = 0;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/oauth2/authorize', (req, res) => {
  counter += 1;
  const code = `mock-code-${counter}`;
  grants[code] = {
    user,
    redirectUri: req.query.redirect_uri,
    codeChallenge: req.query.code_challenge,
  };
  const url = new URL(req.query.redirect_uri);
  url.searchParams.set('code', code);
  url.searchParams.set('state', req.query.state);
  res.redirect(302, url.toString());
});

app.post('/oauth2/token', (req, res) => {
  if (req.headers.authorization !== expectedAuthorization) {
    res.status(401).json({ error: 'invalid_client' });
    return;
  }

  const grant = grants[req.body.code];
  delete grants[req.body.code];

  const codeChallenge = crypto
    .createHash('sha256')
    .update(req.body.code_verifier ?? '')
    .digest('base64url');

  if (
    req.body.grant_type !== 'authorization_code' ||
    !grant ||
    grant.redirectUri !== req.body.redirect_uri ||
    grant.codeChallenge !== codeChallenge
  ) {
    res.status(400).json({ error: 'invalid_grant' });
    return;
  }

  counter += 1;
  const accessToken = `mock-access-token-${counter}`;
  accessTokens[accessToken] = grant.user;
  res.status(200).json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 604800,
    refresh_token: `mock-refresh-token-${counter}`,
    scope: 'identify email',
  });
});

app.get('/users/@me', (req, res) => {
  const tokenUser = accessTokens[
    (req.headers.authorization ?? '').replace(/^Bearer /, '')
  ];
  if (!tokenUser) {
    res.status(401).json({ message: '401: Unauthorized', code: 0 });
    return;
  }
  res.status(200).json(tokenUser);
});

app.post('/control/user', (req, res) => {
  user = req.body;
  res.status(200).send();
});

app.delete('/control', (req, res) => {
  user = defaultUser;
  grants = {};
  accessTokens = {};
  res.status(200).send();
});

app.listen(PORT, () => {
  console.log(`Discord mock running on port ${PORT}`);
});
