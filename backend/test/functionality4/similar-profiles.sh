#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

set_personality () {
  local user=$1
  local x=$2
  local y=$3
  local z=$4

  q "
    update person
    set personality = '[$x,$y,$z$(printf ',0%.0s' {1..44})]'
    where email = '$user@example.com'"
}

similar_names () {
  c GET "/prospect-profile/$1?similar_profiles=true" \
    | jq -r '[.similar_profiles[].name] | join(" ")'
}

setup () {
  q "delete from duo_session"
  q "delete from person"
  q "delete from onboardee"
  q "delete from undeleted_photo"

  ../util/create-user.sh viewer 0
  ../util/create-user.sh target 0
  ../util/create-user.sh near 0
  ../util/create-user.sh middle 0
  ../util/create-user.sh far 0

  q "update person set privacy_verification_level_id = 1"
  q "update person set public_profile = true"

  set_personality viewer 0 0 1
  set_personality target 1 0 0
  set_personality near 1 0 0
  set_personality middle 0.6 0.8 0
  set_personality far 0 1 0

  target_uuid=$(q "select uuid from person where email = 'target@example.com'")
  near_uuid=$(q "select uuid from person where email = 'near@example.com'")
}

signed_in_sorts_cached_search_results () {
  setup

  assume_role viewer

  [[ "$(c GET "/prospect-profile/$target_uuid" | jq 'has("similar_profiles")')" = false ]]

  [[ "$(similar_names "$target_uuid")" = "" ]]

  c GET '/search?n=10&o=0' > /dev/null

  [[ "$(similar_names "$target_uuid")" = "near middle far" ]]
}

signed_out_sorts_public_search_results () {
  setup

  q "update person set public_profile = false where email = 'viewer@example.com'"

  SESSION_TOKEN=""

  [[ "$(similar_names "$target_uuid")" = "near middle far" ]]

  q "update person set public_profile = false where email = 'middle@example.com'"

  [[ "$(similar_names "$near_uuid")" = "target far" ]]
}

signed_out_scores_by_answers () {
  setup

  local qid=$(SESSION_TOKEN="" c GET '/public-next-questions?n=1&o=0' | jq -r '.[0].id')

  assume_role near
  jc POST /answer -d '{ "question_id": '"$qid"', "answer": true,  "public": true }'

  assume_role far
  jc POST /answer -d '{ "question_id": '"$qid"', "answer": false, "public": true }'

  SESSION_TOKEN=""

  [[ "$(
    c GET "/prospect-profile/$target_uuid?similar_profiles=true" \
      | jq -r '[.similar_profiles[].match_percentage] | unique | join(" ")'
  )" = "50" ]]

  local answers=$(jq -rn --arg a \
    '[{ "question_id": '"$qid"', "answer": true, "public": true }]' '$a|@uri')

  local response=$(c GET "/prospect-profile/$target_uuid?similar_profiles=true&answers=$answers")

  [[ "$(echo "$response" | jq -r '[.similar_profiles[].name] | sort | join(" ")')" = "far middle near" ]]

  local m_near=$(echo "$response" | jq -r '.similar_profiles[] | select(.name == "near") | .match_percentage')
  local m_far=$(echo "$response" | jq -r '.similar_profiles[] | select(.name == "far") | .match_percentage')

  [[ "$m_near" -gt "$m_far" ]]
}

signed_in_sorts_cached_search_results
signed_out_sorts_public_search_results
signed_out_scores_by_answers
