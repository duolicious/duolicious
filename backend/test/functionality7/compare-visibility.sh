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

  assume_role viewer
}

# The status code alone: `c` only says whether the request succeeded.
status () {
  curl -s -o /dev/null -w '%{http_code}' \
    --header "Authorization: Bearer $SESSION_TOKEN" \
    "http://localhost:5000$1"
}

# Both compare endpoints answer the viewer's request for `person_id` with
# `expected`.
expect () {
  local person_id=$1
  local expected=$2

  [[ "$(status "/compare-personalities/${person_id}/mbti")" = "$expected" ]]
  [[ "$(status "/compare-answers/${person_id}?agreement=all&topic=all")" = "$expected" ]]
}

prospect_has_messaged_viewer () {
  q "insert into messaged (subject_person_id, object_person_id)
     values ($prospect_id, $viewer_id)"
}

setup

echo 'A visible prospect and the viewer themself can be compared'
expect "$prospect_id" 200
expect "$viewer_id" 200

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

expect "$prospect_id" 200
