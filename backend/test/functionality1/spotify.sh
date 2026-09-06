#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

reset_spotify_mock () {
  curl -s -X DELETE 'http://localhost:3003/control' > /dev/null
}

set_spotify_mock_revoked () {
  curl -s -X POST 'http://localhost:3003/control/revoked' \
    -H 'Content-Type: application/json' \
    -d '{ "revoked": '"$1"' }' > /dev/null
}

set_spotify_mock_artists () {
  curl -s -X POST 'http://localhost:3003/control/artists' \
    -H 'Content-Type: application/json' \
    -d "$1" > /dev/null
}

setup () {
  reset_spotify_mock

  q "delete from person"

  ../util/create-user.sh user1 0 0
  ../util/create-user.sh user2 0 0

  q "update person set roles = array_append(roles, 'spotify-tester')
     where email = 'user1@example.com'"

  assume_role user1
}

mint_state () {
  local authorize_url=$(
    jc POST /spotify/authorize -d '{ "redirect_target": "'"${1:-web}"'" }' \
      | jq -r '.authorize_url'
  )

  grep -qF 'http://spotifymock:3003/authorize?' <<< "$authorize_url"
  grep -qF 'scope=user-top-read' <<< "$authorize_url"

  state=$(sed 's/.*state=\([^&]*\).*/\1/' <<< "$authorize_url")

  [[ -n "$state" ]]
}

callback_location () {
  curl -s -o /dev/null -w '%{redirect_url}' \
    "http://localhost:5000/spotify/callback?$1"
}

first_artist_name () {
  c GET /profile-info | jq -r '.spotify_artists[0].name'
}

make_spotify_stale () {
  q "update person_spotify
     set artists_synced_at = now() - interval '8 days',
         attempted_at = now() - interval '8 days'"
}

callback_status () {
  curl -s -o /dev/null -w '%{http_code}' \
    "http://localhost:5000/spotify/callback?$1"
}

connect_spotify () {
  mint_state web

  local location=$(callback_location "code=mock-code&state=$state")

  [[ "$location" == 'http://test-web.example/?spotify=connected' ]]
}

connect_happy_path () {
  echo 'Connecting Spotify stores tokens and top artists'

  setup

  connect_spotify

  local profile=$(c GET /profile-info)

  [[ "$(jq -r '.spotify_connected' <<< "$profile")" == 'true' ]]
  [[ "$(jq -r '.spotify_artists_synced' <<< "$profile")" == 'true' ]]
  [[ "$(jq -r '.spotify_tester' <<< "$profile")" == 'true' ]]
  j_assert_length "$(jq '.spotify_artists' <<< "$profile")" 10
  [[ "$(jq -r '.spotify_artists[0].name' <<< "$profile")" == 'Mock Artist One' ]]
  [[ "$(jq -r '.spotify_artists[0].spotify_id' <<< "$profile")" == 'artist-id-1' ]]
  [[ "$(jq -r '.spotify_artists[0].image_url' <<< "$profile")" == \
     'http://localhost:3003/image/1-160.svg' ]]

  [[ "$(q "select count(*) from person_spotify")" == "1" ]]
  [[ "$(q "select jsonb_array_length(top_artists) from person_spotify")" == "10" ]]
  [[ "$(q "select count(*) from spotify_oauth_state")" == "0" ]]
}

prospect_visibility () {
  echo "A prospect's profile shows their Spotify artists"

  setup

  connect_spotify

  local user1_uuid=$(get_uuid 'user1@example.com')

  assume_role user2

  local prospect=$(c GET "/prospect-profile/$user1_uuid")

  j_assert_length "$(jq '.spotify_artists' <<< "$prospect")" 10
  [[ "$(jq -r '.spotify_artists[0].name' <<< "$prospect")" == 'Mock Artist One' ]]
}

non_testers_cannot_mint_a_state () {
  echo 'Only spotify-testers can begin the connect flow'

  setup

  assume_role user2

  [[ "$(c GET /profile-info | jq -r '.spotify_tester')" == 'false' ]]

  ! jc POST /spotify/authorize -d '{ "redirect_target": "web" }' || exit 1

  [[ "$(q "select count(*) from spotify_oauth_state")" == "0" ]]
}

role_revocation_blocks_callback () {
  echo 'A state minted before the role was revoked cannot complete the flow'

  setup

  mint_state web

  q "update person set roles = '{}' where email = 'user1@example.com'"

  local location=$(callback_location "code=mock-code&state=$state")

  [[ "$location" == 'http://test-web.example/?spotify_error=invalid_state' ]]

  [[ "$(q "select count(*) from person_spotify")" == "0" ]]
}

state_is_single_use () {
  echo 'A Spotify OAuth state cannot be used twice'

  setup

  connect_spotify

  local location=$(callback_location "code=mock-code&state=$state")

  [[ "$location" == 'http://test-web.example/?spotify_error=invalid_state' ]]
}

state_expires () {
  echo 'An expired Spotify OAuth state is rejected'

  setup

  mint_state web

  q "update spotify_oauth_state set expires_at = now() - interval '1 minute'"

  local location=$(callback_location "code=mock-code&state=$state")

  [[ "$location" == 'http://test-web.example/?spotify_error=invalid_state' ]]

  [[ "$(q "select count(*) from person_spotify")" == "0" ]]
}

garbled_target_is_rejected () {
  echo 'A state with an unknown redirect target gets a 400, not a redirect'

  setup

  [[ "$(callback_status "code=mock-code&state=garbage.evil")" == "400" ]]
  [[ "$(callback_status "code=mock-code&state=no-target-at-all")" == "400" ]]
}

user_denial_redirects_with_error () {
  echo 'Denying the Spotify consent screen redirects back with an error'

  setup

  mint_state web

  local location=$(
    callback_location "error=access_denied&state=$state"
  )

  [[ "$location" == 'http://test-web.example/?spotify_error=access_denied' ]]

  [[ "$(q "select count(*) from person_spotify")" == "0" ]]
}

disconnect_empties_everything () {
  echo 'Disconnecting Spotify removes tokens and artists'

  setup

  connect_spotify

  jc POST /disconnect-spotify

  local profile=$(c GET /profile-info)

  [[ "$(jq -r '.spotify_connected' <<< "$profile")" == 'false' ]]
  [[ "$(jq -c '.spotify_artists' <<< "$profile")" == '[]' ]]

  [[ "$(q "select count(*) from person_spotify")" == "0" ]]
}

cron_refreshes_artists () {
  echo 'The cron picks up a changed artist list'

  setup

  connect_spotify

  set_spotify_mock_artists '[
    {
      "id": "artist-id-4",
      "name": "Mock Artist Four",
      "images": [
        { "url": "http://spotifymock/image/4-640.jpg", "height": 640, "width": 640 },
        { "url": "http://spotifymock/image/4-320.jpg", "height": 320, "width": 320 },
        { "url": "http://spotifymock/image/4-160.jpg", "height": 160, "width": 160 }
      ]
    }
  ]'

  sleep 2

  [[ "$(first_artist_name)" == 'Mock Artist One' ]]

  make_spotify_stale

  assert_eventually 'Mock Artist Four' first_artist_name

  j_assert_length "$(c GET /profile-info | jq '.spotify_artists')" 1
}

failed_initial_fetch_backfills () {
  echo 'A failed artist fetch during connect is backfilled by the cron'

  setup

  set_spotify_mock_artists '[ {} ]'

  connect_spotify

  local profile=$(c GET /profile-info)

  [[ "$(jq -r '.spotify_connected' <<< "$profile")" == 'true' ]]
  [[ "$(jq -r '.spotify_artists_synced' <<< "$profile")" == 'false' ]]
  [[ "$(jq -c '.spotify_artists' <<< "$profile")" == '[]' ]]

  reset_spotify_mock

  sleep 2

  [[ "$(q "select jsonb_array_length(top_artists) from person_spotify")" == "0" ]]

  q "update person_spotify set attempted_at = now() - interval '2 minutes'"

  assert_eventually 10 q "select jsonb_array_length(top_artists) from person_spotify"

  profile=$(c GET /profile-info)

  [[ "$(jq -r '.spotify_artists_synced' <<< "$profile")" == 'true' ]]
  j_assert_length "$(jq '.spotify_artists' <<< "$profile")" 10
}

revocation_clears_tokens_and_artists () {
  echo 'Revoking authorization at Spotify clears tokens and artists'

  setup

  connect_spotify

  set_spotify_mock_revoked true

  make_spotify_stale

  assert_eventually 0 q "select count(*) from person_spotify"

  local profile=$(c GET /profile-info)

  [[ "$(jq -r '.spotify_connected' <<< "$profile")" == 'false' ]]
  [[ "$(jq -c '.spotify_artists' <<< "$profile")" == '[]' ]]
}

deleting_account_cascades () {
  echo 'Deleting an account removes their Spotify rows'

  setup

  connect_spotify

  c DELETE /account

  [[ "$(q "select count(*) from person_spotify")" == "0" ]]
}

connect_happy_path
prospect_visibility
non_testers_cannot_mint_a_state
role_revocation_blocks_callback
state_is_single_use
state_expires
garbled_target_is_rejected
user_denial_redirects_with_error
disconnect_empties_everything
cron_refreshes_artists
failed_initial_fetch_backfills
revocation_clears_tokens_and_artists
deleting_account_cascades
