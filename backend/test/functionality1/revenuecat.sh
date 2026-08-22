#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

has_gold_is_set_by_webhook() {
  say "Configure RevenueCat auth token"
  q "\
  update
    funding
  set
    token_hash_revenuecat = '$(printf 'valid-revenuecat-token' | sha512sum | cut -d' ' -f1)'
  "

  say "Reset core tables to a clean state"
  q "delete from person"
  q "delete from club"
  q "delete from banned_person"

  say "Create two users"
  ../util/create-user.sh rcuser1 0 0
  ../util/create-user.sh rcuser2 0 0

  user1uuid=$(get_uuid 'rcuser1@example.com')
  user2uuid=$(get_uuid 'rcuser2@example.com')

  say "Missing Authorization header returns 400"
  export SESSION_TOKEN=""
  c \
    POST \
    /revenuecat \
    --header "Content-Type: application/json" \
    -d '{ "event": { "type": "EXPIRATION", "app_user_id": "'"$user1uuid"'" } }' \
    && exit 1

  say "Invalid RevenueCat token returns 401"
  export SESSION_TOKEN=""
  c \
    POST \
    /revenuecat \
    --header "Authorization: Bearer invalid-token" \
    --header "Content-Type: application/json" \
    -d '{ "event": { "type": "EXPIRATION", "app_user_id": "'"$user1uuid"'" } }' \
    && exit 1

  say "INITIAL_PURCHASE sets has_gold=true for existing user"
  pre2_before_ip=$(q "select has_gold from person where uuid = '$user2uuid'::uuid")
  export SESSION_TOKEN=""
  response=$(
    c POST /revenuecat \
      --header "Authorization: Bearer valid-revenuecat-token" \
      --header "Content-Type: application/json" \
      -d '{ "api_version": "1", "event": { "type": "INITIAL_PURCHASE", "app_user_id": "'"$user1uuid"'" } }'
  )

  j_assert_length "$(echo "$response" | jq '.all_uuids')" 1
  j_assert_length "$(echo "$response" | jq '.updated_uuids')" 1
  j_assert_length "$(echo "$response" | jq '.ignored_uuids')" 0
  [[ "$(echo "$response" | jq -r '.all_uuids[0]')" == "$user1uuid" ]]
  [[ "$(echo "$response" | jq -r '.updated_uuids[0]')" == "$user1uuid" ]]

  [[ "$(q "select has_gold from person where uuid = '$user1uuid'::uuid")" == t ]]
  [[ "$(q "select has_gold from person where uuid = '$user2uuid'::uuid")" == "$pre2_before_ip" ]]

  say "EXPIRATION sets has_gold=false for existing user"
  pre2_before_exp=$(q "select has_gold from person where uuid = '$user2uuid'::uuid")
  export SESSION_TOKEN=""
  response=$(
    c POST /revenuecat \
      --header "Authorization: Bearer valid-revenuecat-token" \
      --header "Content-Type: application/json" \
      -d '{ "event": { "type": "EXPIRATION", "app_user_id": "'"$user1uuid"'" } }'
  )

  j_assert_length "$(echo "$response" | jq '.all_uuids')" 1
  j_assert_length "$(echo "$response" | jq '.updated_uuids')" 1
  j_assert_length "$(echo "$response" | jq '.ignored_uuids')" 0
  [[ "$(echo "$response" | jq -r '.all_uuids[0]')" == "$user1uuid" ]]
  [[ "$(echo "$response" | jq -r '.updated_uuids[0]')" == "$user1uuid" ]]

  [[ "$(q "select has_gold from person where uuid = '$user1uuid'::uuid")" == f ]]
  [[ "$(q "select has_gold from person where uuid = '$user2uuid'::uuid")" == "$pre2_before_exp" ]]

  say "RENEWAL sets has_gold=true for existing user"
  pre2_before_ren=$(q "select has_gold from person where uuid = '$user2uuid'::uuid")
  export SESSION_TOKEN=""
  response=$(
    c POST /revenuecat \
      --header "Authorization: Bearer valid-revenuecat-token" \
      --header "Content-Type: application/json" \
      -d '{ "event": { "type": "RENEWAL", "app_user_id": "'"$user1uuid"'" } }'
  )

  j_assert_length "$(echo "$response" | jq '.all_uuids')" 1
  j_assert_length "$(echo "$response" | jq '.updated_uuids')" 1
  j_assert_length "$(echo "$response" | jq '.ignored_uuids')" 0
  [[ "$(echo "$response" | jq -r '.all_uuids[0]')" == "$user1uuid" ]]
  [[ "$(echo "$response" | jq -r '.updated_uuids[0]')" == "$user1uuid" ]]

  [[ "$(q "select has_gold from person where uuid = '$user1uuid'::uuid")" == t ]]
  [[ "$(q "select has_gold from person where uuid = '$user2uuid'::uuid")" == "$pre2_before_ren" ]]

  say "TRANSFER moves gold from user1 -> user2"
  # Ensure user2 ends up with gold, user1 without
  export SESSION_TOKEN=""
  response=$(
    c POST /revenuecat \
      --header "Authorization: Bearer valid-revenuecat-token" \
      --header "Content-Type: application/json" \
      -d '{ "event": { "type": "TRANSFER", "transferred_to": ["'"$user2uuid"'"], "transferred_from": ["'"$user1uuid"'" ] } }' \
  )

  # Both UUIDs are referenced
  j_assert_length "$(echo "$response" | jq '.all_uuids')" 2
  # Both should be updated (they exist)
  j_assert_length "$(echo "$response" | jq '.updated_uuids')" 2
  j_assert_length "$(echo "$response" | jq '.ignored_uuids')" 0
  # Ensure the exact UUID set matches
  expected=$(printf "%s\n%s\n" "$user1uuid" "$user2uuid" | sort)
  actual_all=$(echo "$response" | jq -r '.all_uuids[]' | sort)
  actual_updated=$(echo "$response" | jq -r '.updated_uuids[]' | sort)
  [[ "$actual_all" == "$expected" ]]
  [[ "$actual_updated" == "$expected" ]]

  [[ "$(q "select has_gold from person where uuid = '$user1uuid'::uuid")" == f ]]
  [[ "$(q "select has_gold from person where uuid = '$user2uuid'::uuid")" == t ]]

  say "Unknown/ignored events return 200 and perform no updates"
  pre1=$(q "select has_gold from person where uuid = '$user1uuid'::uuid")
  pre2=$(q "select has_gold from person where uuid = '$user2uuid'::uuid")
  export SESSION_TOKEN=""
  c \
    POST \
    /revenuecat \
    --header "Authorization: Bearer valid-revenuecat-token" \
    --header "Content-Type: application/json" \
    -d '{ "event": { "type": "SOME_UNKNOWN_EVENT", "foo": "bar" } }' > /dev/null
  post1=$(q "select has_gold from person where uuid = '$user1uuid'::uuid")
  post2=$(q "select has_gold from person where uuid = '$user2uuid'::uuid")
  [[ "$pre1" == "$post1" ]]
  [[ "$pre2" == "$post2" ]]
}

expiration_resets_settings() {
  say "Configure RevenueCat auth token"
  q "\
  update
    funding
  set
    token_hash_revenuecat = '$(printf 'valid-revenuecat-token' | sha512sum | cut -d' ' -f1)'
  "

  say "Reset core tables to a clean state"
  q "delete from person"
  q "delete from club"
  q "delete from banned_person"

  say "Create user"
  ../util/create-user.sh rcuser3 0 0

  useruuid=$(get_uuid 'rcuser3@example.com')

  say "Grant gold via INITIAL_PURCHASE so theme can be customized"
  export SESSION_TOKEN=""
  c POST /revenuecat \
    --header "Authorization: Bearer valid-revenuecat-token" \
    --header "Content-Type: application/json" \
    -d '{ "event": { "type": "INITIAL_PURCHASE", "app_user_id": "'"$useruuid"'" } }' > /dev/null

  say "Sign in as user to update profile settings"
  assume_role rcuser3

  say "Set non-default theme and privacy settings"
  jc PATCH /profile-info -d '{ "theme": { "title_color": "#111111", "body_color": "#222222", "background_color": "#333333" } }'
  jc PATCH /profile-info -d '{ "show_my_location": "Country only" }'
  jc PATCH /profile-info -d '{ "show_my_age": "No" }'
  jc PATCH /profile-info -d '{ "show_my_looking_for": "No" }'
  jc PATCH /profile-info -d '{ "hide_me_from_strangers": "Yes" }'
  jc PATCH /profile-info -d '{ "browse_invisibly": "Yes" }'

  [[ "$(q "select title_color from person where uuid = '$useruuid'::uuid")" == "#111111" ]]
  [[ "$(q "select body_color from person where uuid = '$useruuid'::uuid")" == "#222222" ]]
  [[ "$(q "select background_color from person where uuid = '$useruuid'::uuid")" == "#333333" ]]
  [[ "$(q "
    select yes_country_only_no.name
    from person
    join yes_country_only_no
      on yes_country_only_no.id = person.show_my_location_id
    where person.uuid = '$useruuid'::uuid")" == "Country only" ]]
  [[ "$(q "select show_my_age from person where uuid = '$useruuid'::uuid")" == f ]]
  [[ "$(q "select show_my_looking_for from person where uuid = '$useruuid'::uuid")" == f ]]
  [[ "$(q "select hide_me_from_strangers from person where uuid = '$useruuid'::uuid")" == t ]]
  [[ "$(q "select browse_invisibly from person where uuid = '$useruuid'::uuid")" == t ]]

  say "EXPIRATION resets theme and privacy settings"
  export SESSION_TOKEN=""
  c POST /revenuecat \
    --header "Authorization: Bearer valid-revenuecat-token" \
    --header "Content-Type: application/json" \
    -d '{ "event": { "type": "EXPIRATION", "app_user_id": "'"$useruuid"'" } }' > /dev/null

  [[ "$(q "select has_gold from person where uuid = '$useruuid'::uuid")" == f ]]
  [[ "$(q "select title_color from person where uuid = '$useruuid'::uuid")" == "#000000" ]]
  [[ "$(q "select body_color from person where uuid = '$useruuid'::uuid")" == "#000000" ]]
  [[ "$(q "select background_color from person where uuid = '$useruuid'::uuid")" == "#ffffff" ]]
  [[ "$(q "
    select yes_country_only_no.name
    from person
    join yes_country_only_no
      on yes_country_only_no.id = person.show_my_location_id
    where person.uuid = '$useruuid'::uuid")" == "Yes" ]]
  [[ "$(q "select show_my_age from person where uuid = '$useruuid'::uuid")" == t ]]
  [[ "$(q "select show_my_looking_for from person where uuid = '$useruuid'::uuid")" == t ]]
  [[ "$(q "select hide_me_from_strangers from person where uuid = '$useruuid'::uuid")" == f ]]
  [[ "$(q "select browse_invisibly from person where uuid = '$useruuid'::uuid")" == f ]]
}

premium_features_require_gold() {
  say "Reset core tables to a clean state"
  q "delete from person"
  q "delete from club"
  q "delete from banned_person"

  say "Create user (no gold)"
  ../util/create-user.sh rcuser5 0 0
  q "update person set has_gold = false where name = 'rcuser5'"

  say "Sign in as user"
  assume_role rcuser5

  say "Premium features must return 403 without gold"
  jc PATCH /profile-info -d '{ "theme": { "title_color": "#123456", "body_color": "#234567", "background_color": "#345678" } }' && exit 1
  jc PATCH /profile-info -d '{ "browse_invisibly": "Yes" }' && exit 1
  jc PATCH /profile-info -d '{ "show_my_location": "No" }' && exit 1
  jc PATCH /profile-info -d '{ "show_my_location": "Country only" }' && exit 1
  jc PATCH /profile-info -d '{ "show_my_age": "No" }' && exit 1
  jc PATCH /profile-info -d '{ "show_my_looking_for": "No" }' && exit 1
  jc PATCH /profile-info -d '{ "hide_me_from_strangers": "Yes" }' && exit 1

  return 0
}

count_members_drift () {
  q "\
    select count(*) \
    from club \
    left join ( \
      select club_name, count(*) as cnt \
      from person_club \
      where activated \
      group by club_name \
    ) pc on pc.club_name = club.name \
    where club.count_members is distinct from coalesce(pc.cnt, 0)"
}

check_club_counts_consistent () {
  assert_eventually "0" count_members_drift
}

club_counts_survive_gold_expiry_while_deactivated() {
  say "Configure RevenueCat auth token"
  q "\
  update
    funding
  set
    token_hash_revenuecat = '$(printf 'valid-revenuecat-token' | sha512sum | cut -d' ' -f1)'
  "

  say "Reset core tables to a clean state"
  q "delete from person"
  q "delete from person_club"
  q "delete from club"
  q "delete from banned_person"

  say "Create a gold user over the free club quota and a bystander"
  ../util/create-user.sh rcuser6 0 0
  ../util/create-user.sh rcuser7 0 0

  useruuid=$(get_uuid 'rcuser6@example.com')

  assume_role rcuser6
  for i in {1..60}
  do
    jc POST /join-club -d '{ "name": "rc-club-'$i'" }'
  done

  assume_role rcuser7
  jc POST /join-club -d '{ "name": "rc-club-1" }'

  check_club_counts_consistent

  say "Deactivate the gold user"
  assume_role rcuser6
  c POST /deactivate

  check_club_counts_consistent

  say "EXPIRATION while deactivated evicts over-quota clubs without corrupting counts"
  export SESSION_TOKEN=""
  c POST /revenuecat \
    --header "Authorization: Bearer valid-revenuecat-token" \
    --header "Content-Type: application/json" \
    -d '{ "event": { "type": "EXPIRATION", "app_user_id": "'"$useruuid"'" } }' > /dev/null

  [[ $(q "\
    select count(*) \
    from person_club \
    where person_id = (select id from person where uuid = '$useruuid'::uuid)") == 50 ]]
  check_club_counts_consistent

  say "Signing back in restores the remaining memberships' counts"
  assume_role rcuser6
  check_club_counts_consistent
}

clean_up () {
  q "select setval(pg_get_serial_sequence('person','id'), 1, true)"
}

has_gold_is_set_by_webhook
expiration_resets_settings
premium_features_require_gold
club_counts_survive_gold_expiry_while_deactivated

clean_up
