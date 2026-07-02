#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

# Shadow-banned users must appear not to exist in other users' discovery
# surfaces (search, visitors, inbox), while the app keeps behaving normally for
# the shadow-banned user themselves. Their profile remains reachable via a
# direct link, so sharing a profile URL keeps working.

setup () {
  q "delete from duo_session"
  q "delete from person"
  q "delete from club"
  q "delete from onboardee"
  q "delete from undeleted_photo"
  q "delete from messaged"
  q "delete from skipped"
  q "delete from visited"

  ../util/create-user.sh searcher 0 0
  ../util/create-user.sh user1 0 0
  ../util/create-user.sh user2 0 0

  # Make everyone mutually visible/searchable
  q "update person set privacy_verification_level_id = 1"
  q "update person set personality = array_full(47, 1e-5)"

  searcher_id=$(q "select id from person where name = 'searcher'")
  user1_id=$(q "select id from person where name = 'user1'")
  user2_id=$(q "select id from person where name = 'user2'")

  searcher_uuid=$(q "select uuid from person where name = 'searcher'")
  user1_uuid=$(q "select uuid from person where name = 'user1'")
  user2_uuid=$(q "select uuid from person where name = 'user2'")
}

ban () {
  q "update person set shadow_banned_at = now() where name = '$1'"
}

unban () {
  q "update person set shadow_banned_at = null where name = '$1'"
}

search_names () {
  c GET "/search?n=10&o=0" | jq -r '[.[].name] | sort | join(" ")'
}

club_search_names () {
  c GET "/search?n=10&o=0&club=$1" | jq -r '[.[].name] | sort | join(" ")'
}

test_search_hides_banned_from_others () {
  setup

  assume_role searcher
  [[ "$(search_names)" = "user1 user2" ]]

  ban user1

  # The searcher no longer sees the shadow-banned user1
  assume_role searcher
  [[ "$(search_names)" = "user2" ]]

  # ...but the shadow-banned user1 still searches normally and sees everyone else
  assume_role user1
  [[ "$(search_names)" = "searcher user2" ]]
}

test_club_search_hides_banned_from_others () {
  setup

  assume_role user1 ; jc POST /join-club -d '{ "name": "Anime" }'
  assume_role user2 ; jc POST /join-club -d '{ "name": "Anime" }'

  assume_role searcher
  [[ "$(club_search_names Anime)" = "user1 user2" ]]

  # The club search path joins person_club but filters on `person` (person_club
  # deliberately doesn't carry the column), so the ban must still take effect.
  ban user1
  assume_role searcher
  [[ "$(club_search_names Anime)" = "user2" ]]
}

test_prospect_profile () {
  setup

  ban user1

  # A shadow ban hides the user from search, but the profile is still
  # reachable via a direct link: a signed-in stranger can open it
  assume_role user2
  [[ "$(c GET "/prospect-profile/${user1_uuid}" | jq -r '.name')" = "user1" ]]

  # An anonymous viewer can open it too when the profile is public
  q "update person set public_profile = true where name = 'user1'"
  SESSION_TOKEN=""
  [[ "$(c GET "/prospect-profile/${user1_uuid}" | jq -r '.name')" = "user1" ]]

  # The shadow-banned user can still view their own profile
  assume_role user1
  [[ "$(c GET "/prospect-profile/${user1_uuid}" | jq -r '.name')" = "user1" ]]
}

test_conversation_prospect () {
  setup

  ban user1

  # A stranger can't open the shadow-banned user's conversation header
  assume_role user2
  ! c GET "/conversation-prospect/${user1_uuid}" > /dev/null || exit 1

  # The shadow-banned user's own conversation header still works
  assume_role user1
  [[ "$(c GET "/conversation-prospect/${user1_uuid}" | jq -r '.name')" = "user1" ]]
}

test_inbox_info () {
  setup

  # user1 messaged user2
  q "insert into messaged (subject_person_id, object_person_id) values (${user1_id}, ${user2_id})"

  ban user1

  # From user2's perspective the shadow-banned partner is anonymised, exactly
  # like a deactivated account: the uuid is returned but the name/photo are not.
  assume_role user2
  response=$(jc POST "/inbox-info" -d "{ \"person_uuids\": [\"${user1_uuid}\"] }")

  [[ "$(echo "$response" | jq -r '.[0].person_uuid')" = "${user1_uuid}" ]]
  [[ "$(echo "$response" | jq -r '.[0].name')" = "null" ]]
}

test_compare_answers () {
  setup

  question_id=$(q "select id from question order by id limit 1")

  assume_role user1
  jc POST /answer -d "{ \"question_id\": ${question_id}, \"answer\": true, \"public\": true }"

  assume_role searcher
  jc POST /answer -d "{ \"question_id\": ${question_id}, \"answer\": true, \"public\": true }"

  # The comparison works before the ban...
  before=$(c GET "/compare-answers/${user1_id}?agreement=all&topic=all")
  [[ "$(echo "$before" | jq 'length')" -ge 1 ]]

  # ...and returns nothing once user1 is shadow-banned
  ban user1
  after=$(c GET "/compare-answers/${user1_id}?agreement=all&topic=all")
  [[ "$(echo "$after" | jq 'length')" -eq 0 ]]
}

test_data_export_hides_the_flag () {
  setup

  ban user1

  # The export must not reveal the ban to the shadow-banned user themselves
  assume_role user1
  token=$(c GET '/export-data-token' | jq -r '.token')
  export_json=$(c GET "/export-data/${token}")

  # Sanity check: the export succeeded and contains the user's own data...
  echo "$export_json" | grep -q 'user1@example.com' || exit 1
  # ...but it never reveals the shadow_banned_at column.
  ! echo "$export_json" | grep -q shadow_banned_at || exit 1
}

test_search_hides_banned_from_others
test_club_search_hides_banned_from_others
test_prospect_profile
test_conversation_prospect
test_inbox_info
test_compare_answers
test_data_export_hides_the_flag
