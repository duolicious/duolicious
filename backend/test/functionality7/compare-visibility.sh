#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

setup () {
  q "delete from duo_session"
  q "delete from person"
  q "delete from onboardee"
  q "delete from undeleted_photo"

  ../util/create-user.sh viewer 0
  ../util/create-user.sh prospect 0

  viewer_id=$(q "select id from person where email = 'viewer@example.com'")
  prospect_id=$(q "select id from person where email = 'prospect@example.com'")

  assume_role prospect
  answer_questions false

  assume_role viewer
  answer_questions true
}

answer_questions () {
  for question_id in $(seq 1 120)
  do
    answer "$question_id" "$1" true
  done
}

request () {
  curl -s -w '\n%{http_code}' \
    --header "Authorization: Bearer $SESSION_TOKEN" \
    "http://localhost:5000$1"
}

expect () {
  local person_id=$1
  local expected=$2
  local endpoint
  local response

  for endpoint in \
    "/compare-personalities/${person_id}/mbti" \
    "/compare-answers/${person_id}?agreement=all&topic=all"
  do
    response=$(request "$endpoint")
    [[ "${response##*$'\n'}" = "$expected" ]]
    [[ "$expected" = 200 || -z "${response%$'\n'*}" ]]
  done
}

personality_comparison () {
  local person_id=$1
  local prospect_id=$2

  q "
    select
      jsonb_agg(
        jsonb_build_object(
          'trait_name', trait.name,
          'person_name', person.name,
          'person_percentage', round(100 * person_trait.ratio),
          'prospect_name', prospect.name,
          'prospect_percentage', round(100 * prospect_trait.ratio)
        )
        order by prospect_trait.ratio desc, trait.name
      )
    from
      trait_topic
    join trait
      on trait.id = trait_topic.trait_id
    join person
      on person.id = $person_id
    join person as prospect
      on prospect.id = $prospect_id
    join trait_ratio(person.presence_score, person.absence_score, 5000) as person_trait
      on person_trait.trait_id = trait.id
    join trait_ratio(prospect.presence_score, prospect.absence_score, 5000) as prospect_trait
      on prospect_trait.trait_id = trait.id
    where
      trait_topic.name = 'MBTI'"
}

expect_personality_comparison () {
  local prospect_id=$1
  local expected
  local response

  expected=$(personality_comparison "$viewer_id" "$prospect_id")
  echo "$expected" | jq -e 'all(.[]; .person_percentage != null and .prospect_percentage != null)'

  response=$(c GET "/compare-personalities/${prospect_id}/mbti")
  j_assert_length "$response" "$(q "select count(*) from trait_topic where name = 'MBTI'")"
  echo "$response" | jq -e --argjson expected "$expected" '
    [
      .[]
      | {trait_name, person_name, person_percentage, prospect_name, prospect_percentage}
    ] == $expected'
}

prospect_has_messaged_viewer () {
  q "insert into messaged (subject_person_id, object_person_id)
     values ($prospect_id, $viewer_id)"
}

setup

echo 'A visible prospect and the viewer themself can be compared'
expect "$prospect_id" 200
expect "$viewer_id" 200

echo "Comparing personalities gives each of the topic's traits, ordered by the prospect's score"
expect_personality_comparison "$prospect_id"

echo "Comparing personalities with oneself gives the viewer's own scores on both sides"
expect_personality_comparison "$viewer_id"

echo 'A visible prospect with no answers in common gives an empty list'
response=$(c GET "/compare-answers/${prospect_id}?agreement=agree&topic=all")
[[ "$(echo "$response" | jq -c .)" = '[]' ]]

echo 'An id nobody has looks the same as a hidden prospect'
expect "$(q "select coalesce(max(id), 0) + 1000 from person")" 404

echo 'A deactivated prospect is hidden'
q "update person set activated = false where id = $prospect_id"
expect "$prospect_id" 404
q "update person set activated = true where id = $prospect_id"

echo 'A prospect hidden from strangers is hidden until they message the viewer'
q "update person set hide_me_from_strangers = true where id = $prospect_id"
expect "$prospect_id" 404
prospect_has_messaged_viewer
expect "$prospect_id" 200
q "delete from messaged"

echo 'A public profile overrides hiding from strangers'
q "update person set public_profile = true where id = $prospect_id"
expect "$prospect_id" 200
q "update person set hide_me_from_strangers = false, public_profile = false where id = $prospect_id"

echo 'A prospect requiring more verification than the viewer has is hidden until they message the viewer'
q "update person set privacy_verification_level_id = 3 where id = $prospect_id"
q "update person set verification_level_id = 1 where id = $viewer_id"
expect "$prospect_id" 404
prospect_has_messaged_viewer
expect "$prospect_id" 200
q "delete from messaged"
q "update person set privacy_verification_level_id = 1 where id = $prospect_id"

echo 'A prospect who has skipped the viewer is hidden'
q "insert into skipped (subject_person_id, object_person_id)
   values ($prospect_id, $viewer_id)"
expect "$prospect_id" 404
q "delete from skipped"

echo 'A shadow-banned prospect stays visible, as on their profile'
q "update person set shadow_banned_at = now() where id = $prospect_id"
expect "$prospect_id" 200
q "update person set shadow_banned_at = null where id = $prospect_id"

echo 'The viewer can compare themself while hidden from strangers'
q "update person set hide_me_from_strangers = true where id = $viewer_id"
expect "$viewer_id" 200
q "update person set hide_me_from_strangers = false where id = $viewer_id"
