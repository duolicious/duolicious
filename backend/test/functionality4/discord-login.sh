#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM

setup () {
  curl -s -X DELETE 'http://localhost:3005/control' > /dev/null

  q "delete from duo_session"
  q "delete from social_identity"
  q "delete from person"
  q "delete from onboardee"
  q "delete from banned_person"

  SESSION_TOKEN=""
}

set_discord_user () {
  curl -s -X POST 'http://localhost:3005/control/user' \
    -H 'Content-Type: application/json' \
    -d "$1" > /dev/null
}

location () {
  curl -s -o /dev/null -w '%{redirect_url}' "$1"
}

status () {
  curl -s -o /dev/null -w '%{http_code}' "$@"
}

authorize () {
  location "http://localhost:5000/auth/discord/authorize?redirect_target=${1:-web}&code_challenge=$challenge"
}

discord_code () {
  sed 's/.*discord_code=//' <<< "$(location "$(location "$(authorize)")")"
}

sign_in_body () {
  jq -nc --arg code "$1" --arg verifier "${2:-$verifier}" \
    '{ code: $code, code_verifier: $verifier }'
}

sign_in_with_discord () {
  jc POST /sign-in-with-discord -d "$(sign_in_body "$@")"
}

sign_in_status () {
  status -X POST http://localhost:5000/sign-in-with-discord \
    -H 'Content-Type: application/json' \
    -d "$(sign_in_body "$@")"
}

authorize_redirects_to_discord () {
  echo 'Authorizing sends the browser to Discord with a PKCE challenge'

  [[ "$(authorize)" == "http://localhost:3005/oauth2/authorize?client_id=test-discord-client-id&redirect_uri=http%3A%2F%2Flocalhost%3A5000%2Fauth%2Fdiscord%2Fcallback&response_type=code&scope=identify%20email&state=web&code_challenge=$challenge&code_challenge_method=S256&prompt=none" ]]

  [[ "$(status "http://localhost:5000/auth/discord/authorize?redirect_target=evil&code_challenge=$challenge")" == 400 ]]
  [[ "$(status "http://localhost:5000/auth/discord/authorize?redirect_target=web&code_challenge=short")" == 400 ]]
}

callback_returns_to_the_client () {
  echo 'The callback hands the code or error to the client that started the flow'

  [[ "$(location 'http://localhost:5000/auth/discord/callback?code=abc&state=web')" == 'http://test-web.example/?discord_code=abc' ]]
  [[ "$(location 'http://localhost:5000/auth/discord/callback?code=abc&state=apex')" == 'http://test-apex.example/?discord_code=abc' ]]
  [[ "$(location 'http://localhost:5000/auth/discord/callback?code=abc&state=app')" == 'http://test-app.example/?discord_code=abc' ]]
  [[ "$(location 'http://localhost:5000/auth/discord/callback?error=access_denied&state=web')" == 'http://test-web.example/?discord_error=access_denied' ]]
  [[ "$(location 'http://localhost:5000/auth/discord/callback?state=web')" == 'http://test-web.example/?discord_error=missing_code' ]]
  [[ "$(status 'http://localhost:5000/auth/discord/callback?code=abc&state=evil')" == 400 ]]
}

sign_up_then_sign_in () {
  echo 'A new Discord user onboards with their Discord account linked, then signs back in'

  setup

  local response=$(
    jc POST /sign-in-with-discord -d "$(
      sign_in_body "$(discord_code)" \
        | jq -c '. + { pending_club_name: "some-club", ref: "discord-ref" }'
    )"
  )

  [[ "$(jq -r .onboarded <<< "$response")" == false ]]
  [[ "$(q "select pending_social_provider from duo_session")" == discord ]]
  [[ "$(q "select pending_social_sub from duo_session")" == 80351110224678912 ]]

  SESSION_TOKEN=$(jq -r .session_token <<< "$response")
  complete_onboarding_for_current_session

  local person_id=$(get_id 'discord-user@example.com')
  [[ "$(q "select count(*) from social_identity where provider = 'discord' and provider_sub = '80351110224678912' and person_id = $person_id")" == 1 ]]
  [[ "$(q "select ref from person_ref where person_id = $person_id")" == discord-ref ]]
  [[ "$(q "select count(*) from person_club where person_id = $person_id and club_name = 'some-club'")" == 1 ]]

  SESSION_TOKEN=""
  response=$(sign_in_with_discord "$(discord_code)")

  [[ "$(jq -r .onboarded <<< "$response")" == true ]]
  [[ "$(jq -r .person_id <<< "$response")" == "$person_id" ]]
}

verified_email_signs_in_to_the_existing_account () {
  echo 'A verified Discord email signs in to the account that already has it'

  setup

  ../util/create-user.sh discord-user 0 0
  local person_id=$(get_id 'discord-user@example.com')

  local response=$(sign_in_with_discord "$(discord_code)")

  [[ "$(jq -r .onboarded <<< "$response")" == true ]]
  [[ "$(jq -r .person_id <<< "$response")" == "$person_id" ]]
  [[ "$(q "select count(*) from social_identity where provider = 'discord' and person_id = $person_id")" == 1 ]]
}

unverified_or_missing_email_is_rejected () {
  echo 'A Discord account without a verified email cannot sign up'

  setup

  set_discord_user '{ "id": "1", "email": "unverified@example.com", "verified": false }'
  [[ "$(sign_in_status "$(discord_code)")" == 409 ]]

  set_discord_user '{ "id": "2", "email": null, "verified": false }'
  [[ "$(sign_in_status "$(discord_code)")" == 400 ]]

  [[ "$(q "select count(*) from onboardee")" == 0 ]]
}

code_needs_its_verifier_and_works_once () {
  echo 'A code only redeems once, and only with the verifier its flow started with'

  setup

  [[ "$(sign_in_status "$(discord_code)" "${verifier}x")" == 401 ]]

  local code=$(discord_code)
  [[ "$(sign_in_status "$code")" == 200 ]]
  [[ "$(sign_in_status "$code")" == 401 ]]
}

authorize_redirects_to_discord
callback_returns_to_the_client
sign_up_then_sign_in
verified_email_signs_in_to_the_existing_account
unverified_or_missing_email_is_rejected
code_needs_its_verifier_and_works_once
