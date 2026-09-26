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

discord_return () {
  location "$(location "$(authorize)")"
}

sign_in_body () {
  jq -nc --arg url "$1" --arg verifier "${2:-$verifier}" \
    '$url | capture("discord_code=(?<code>[^&]*)&discord_state=(?<state>.*)")
      | . + { code_verifier: $verifier }'
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

  [[ "$(authorize)" == "http://localhost:3005/oauth2/authorize?client_id=test-discord-client-id&redirect_uri=http%3A%2F%2Flocalhost%3A5000%2Fauth%2Fdiscord%2Fcallback&response_type=code&scope=identify%20email&state=$challenge.web&code_challenge=$challenge&code_challenge_method=S256&prompt=none" ]]

  [[ "$(status "http://localhost:5000/auth/discord/authorize?redirect_target=evil&code_challenge=$challenge")" == 400 ]]
  [[ "$(status "http://localhost:5000/auth/discord/authorize?redirect_target=web&code_challenge=short")" == 400 ]]
}

callback_returns_to_the_client () {
  echo 'The callback hands the code or error to the client that started the flow'

  [[ "$(location 'http://localhost:5000/auth/discord/callback?code=abc&state=x.web')" == 'http://test-web.example/?discord_code=abc&discord_state=x.web' ]]
  [[ "$(location 'http://localhost:5000/auth/discord/callback?code=abc&state=x.apex')" == 'http://test-apex.example/?discord_code=abc&discord_state=x.apex' ]]
  [[ "$(location 'http://localhost:5000/auth/discord/callback?code=abc&state=x.app')" == 'http://test-app.example/?discord_code=abc&discord_state=x.app' ]]
  [[ "$(location 'http://localhost:5000/auth/discord/callback?error=access_denied&state=web')" == 'http://test-web.example/?discord_error=access_denied' ]]
  [[ "$(location 'http://localhost:5000/auth/discord/callback?state=web')" == 'http://test-web.example/?discord_error=missing_code' ]]
  [[ "$(status 'http://localhost:5000/auth/discord/callback?code=abc&state=x.evil')" == 400 ]]
}

sign_up_then_sign_in () {
  echo 'A new Discord user onboards with their Discord account linked, then signs back in'

  setup

  local response=$(
    jc POST /sign-in-with-discord -d "$(
      sign_in_body "$(discord_return)" \
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
  response=$(sign_in_with_discord "$(discord_return)")

  [[ "$(jq -r .onboarded <<< "$response")" == true ]]
  [[ "$(jq -r .person_id <<< "$response")" == "$person_id" ]]
}

existing_account_links_after_an_emailed_code () {
  echo 'A Discord email that matches an account links to it once the emailed code is entered'

  setup

  ../util/create-user.sh discord-user 0 0
  local person_id=$(get_id 'discord-user@example.com')

  local response=$(sign_in_with_discord "$(discord_return)")

  [[ "$(jq -r .otp_email <<< "$response")" == discord-user@example.com ]]
  [[ "$(q "select count(*) from social_identity")" == 0 ]]

  SESSION_TOKEN=$(jq -r .session_token <<< "$response")
  c POST /resend-otp
  jc POST /check-otp -d '{ "otp": "000000" }'

  [[ "$(q "select count(*) from social_identity where provider = 'discord' and person_id = $person_id")" == 1 ]]

  SESSION_TOKEN=""
  response=$(sign_in_with_discord "$(discord_return)")
  [[ "$(jq -r .person_id <<< "$response")" == "$person_id" ]]
}

unverified_missing_or_unsupported_email_is_rejected () {
  echo 'A Discord account needs a verified email from a supported provider to sign up'

  setup

  set_discord_user '{ "id": "1", "email": "unverified@example.com", "verified": false }'
  [[ "$(sign_in_status "$(discord_return)")" == 409 ]]

  set_discord_user '{ "id": "2", "email": null, "verified": false }'
  [[ "$(sign_in_status "$(discord_return)")" == 409 ]]

  set_discord_user '{ "id": "3", "email": "someone@unlisted-domain.test", "verified": true }'
  [[ "$(sign_in_status "$(discord_return)")" == 409 ]]

  [[ "$(q "select count(*) from onboardee")" == 0 ]]
}

code_needs_its_flow_and_works_once () {
  echo 'A code only redeems once, and only with the state and verifier its flow started with'

  setup

  [[ "$(sign_in_status "$(discord_return)" "${verifier}x")" == 400 ]]

  local url=$(discord_return)
  [[ "$(sign_in_status "$url")" == 200 ]]
  [[ "$(sign_in_status "$url")" == 401 ]]
}

authorize_redirects_to_discord
callback_returns_to_the_client
sign_up_then_sign_in
existing_account_links_after_an_emailed_code
unverified_missing_or_unsupported_email_is_rejected
code_needs_its_flow_and_works_once
