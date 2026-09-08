#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

setup_fresh_users () {
  q "delete from duo_session"
  q "delete from person"
  q "delete from club"
  q "delete from onboardee"
  q "delete from undeleted_photo"

  ../util/create-user.sh user1 0 0
  ../util/create-user.sh user2 0 0

  # Ensure privacy gating doesn't hide fields
  q "update person set privacy_verification_level_id = 1"
}

# The whole point of the endpoint: fetching a conversation header must NOT
# leave a row in `visited`, otherwise opening someone's chat will surface them
# as a profile visitor.
does_not_record_a_visit () {
  setup_fresh_users

  user2_uuid=$(q "select uuid from person where name = 'user2'")

  assume_role user1
  c GET "/conversation-prospect/${user2_uuid}" > /dev/null

  [[ "$(q "select count(*) from visited")" -eq 0 ]]

  # Sanity-check by contrast: the existing /prospect-profile DOES write a row.
  c GET "/prospect-profile/${user2_uuid}" > /dev/null
  [[ "$(q "select count(*) from visited")" -eq 1 ]]
}

returns_only_header_fields () {
  setup_fresh_users

  user2_uuid=$(q "select uuid from person where name = 'user2'")

  assume_role user1

  response=$(c GET "/conversation-prospect/${user2_uuid}")

  expected=$(jq -r . << EOF
{
  "is_available": true,
  "name": "user2",
  "url_slug": "user2",
  "photo_uuid": null,
  "photo_blurhash": null,
  "is_skipped": false
}
EOF
)

  diff <(echo "$response" | jq -S .) <(echo "$expected" | jq -S .)
}

reflects_skipped_state () {
  setup_fresh_users

  user1_id=$(q "select id from person where name = 'user1'")
  user2_id=$(q "select id from person where name = 'user2'")
  user2_uuid=$(q "select uuid from person where name = 'user2'")

  # user1 has skipped user2: the menu's "Undo skip" should reflect that.
  q "insert into skipped (subject_person_id, object_person_id) values (${user1_id}, ${user2_id})"

  assume_role user1
  response=$(c GET "/conversation-prospect/${user2_uuid}")

  [[ "$(echo "$response" | jq -r '.is_skipped')" == "true" ]]
  [[ "$(echo "$response" | jq -r '.name')" == "user2" ]]
}

prospect_skipped_viewer_returns_404 () {
  # If the prospect has skipped/blocked the viewer, /prospect-profile 404s.
  # The conversation header should behave the same way so the chat screen
  # uses its existing "this person isn't available" UI.
  setup_fresh_users

  user1_id=$(q "select id from person where name = 'user1'")
  user2_id=$(q "select id from person where name = 'user2'")
  user2_uuid=$(q "select uuid from person where name = 'user2'")

  q "insert into skipped (subject_person_id, object_person_id) values (${user2_id}, ${user1_id})"

  assume_role user1
  ! c GET "/conversation-prospect/${user2_uuid}" || exit 1
}

unknown_uuid_returns_404 () {
  setup_fresh_users

  assume_role user1
  ! c GET "/conversation-prospect/00000000-0000-0000-0000-000000000000" \
    || exit 1
}

requires_auth () {
  setup_fresh_users

  user2_uuid=$(q "select uuid from person where name = 'user2'")

  SESSION_TOKEN=""
  ! c GET "/conversation-prospect/${user2_uuid}" || exit 1
}

does_not_record_a_visit
returns_only_header_fields
reflects_skipped_state
prospect_skipped_viewer_returns_404
unknown_uuid_returns_404
requires_auth
