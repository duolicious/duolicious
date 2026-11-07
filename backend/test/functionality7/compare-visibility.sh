#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from duo_session"
q "delete from person"
q "delete from onboardee"
q "delete from undeleted_photo"

../util/create-user.sh viewer 0
../util/create-user.sh prospect 0

viewer_id=$(q "select id from person where email = 'viewer@example.com'")
prospect_id=$(q "select id from person where email = 'prospect@example.com'")
mbti_traits=$(q "select count(*) from trait_topic where name = 'MBTI'")

assume_role prospect
answer 1 true true

assume_role viewer
answer 1 true true

expect_visible () {
  j_assert_length "$(c GET "/compare-personalities/$1/mbti")" "$mbti_traits"
}

expect_hidden () {
  [[ "$(c GET "/compare-personalities/$1/mbti")" = '[]' ]]
  [[ "$(c GET "/compare-answers/$1?agreement=all&topic=all")" = '[]' ]]
}

prospect_has_messaged_viewer () {
  q "insert into messaged (subject_person_id, object_person_id)
     values ($prospect_id, $viewer_id)"
}

echo 'A visible prospect and the viewer themself can be compared'
expect_visible "$prospect_id"
expect_visible "$viewer_id"
j_assert_length "$(c GET "/compare-answers/${prospect_id}?agreement=all&topic=all")" 1
j_assert_length "$(c GET "/compare-answers/${viewer_id}?agreement=all&topic=all")" 1

echo 'An id nobody has looks the same as a hidden prospect'
expect_hidden "$(q "select coalesce(max(id), 0) + 1000 from person")"

echo 'A deactivated prospect is hidden'
q "update person set activated = false where id = $prospect_id"
expect_hidden "$prospect_id"
q "update person set activated = true where id = $prospect_id"

echo 'A prospect hidden from strangers is hidden until they message the viewer'
q "update person set hide_me_from_strangers = true where id = $prospect_id"
expect_hidden "$prospect_id"
prospect_has_messaged_viewer
expect_visible "$prospect_id"
q "delete from messaged"

echo 'A public profile overrides hiding from strangers'
q "update person set public_profile = true where id = $prospect_id"
expect_visible "$prospect_id"
q "update person set hide_me_from_strangers = false, public_profile = false where id = $prospect_id"

echo 'A prospect requiring more verification than the viewer has is hidden until they message the viewer'
q "update person set privacy_verification_level_id = 3 where id = $prospect_id"
q "update person set verification_level_id = 1 where id = $viewer_id"
expect_hidden "$prospect_id"
prospect_has_messaged_viewer
expect_visible "$prospect_id"
q "delete from messaged"
q "update person set privacy_verification_level_id = 1 where id = $prospect_id"

echo 'A prospect who has skipped the viewer is hidden'
q "insert into skipped (subject_person_id, object_person_id)
   values ($prospect_id, $viewer_id)"
expect_hidden "$prospect_id"
q "delete from skipped"

echo 'A shadow-banned prospect stays visible, as on their profile'
q "update person set shadow_banned_at = now() where id = $prospect_id"
expect_visible "$prospect_id"
q "update person set shadow_banned_at = null where id = $prospect_id"

echo 'The viewer can compare themself while hidden from strangers'
q "update person set hide_me_from_strangers = true where id = $viewer_id"
expect_visible "$viewer_id"
q "update person set hide_me_from_strangers = false where id = $viewer_id"
