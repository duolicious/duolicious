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
  pre2_before_ip=$(has_gold "uuid = '$user2uuid'::uuid")
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

  [[ "$(has_gold "uuid = '$user1uuid'::uuid")" == t ]]
  [[ "$(has_gold "uuid = '$user2uuid'::uuid")" == "$pre2_before_ip" ]]

  say "EXPIRATION sets has_gold=false for existing user"
  pre2_before_exp=$(has_gold "uuid = '$user2uuid'::uuid")
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

  [[ "$(has_gold "uuid = '$user1uuid'::uuid")" == f ]]
  [[ "$(has_gold "uuid = '$user2uuid'::uuid")" == "$pre2_before_exp" ]]

  say "RENEWAL sets has_gold=true for existing user"
  pre2_before_ren=$(has_gold "uuid = '$user2uuid'::uuid")
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

  [[ "$(has_gold "uuid = '$user1uuid'::uuid")" == t ]]
  [[ "$(has_gold "uuid = '$user2uuid'::uuid")" == "$pre2_before_ren" ]]

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

  [[ "$(has_gold "uuid = '$user1uuid'::uuid")" == f ]]
  [[ "$(has_gold "uuid = '$user2uuid'::uuid")" == t ]]

  say "TRANSFER naming one person in both lists leaves them with gold"
  export SESSION_TOKEN=""
  c POST /revenuecat \
    --header "Authorization: Bearer valid-revenuecat-token" \
    --header "Content-Type: application/json" \
    -d '{ "event": { "type": "TRANSFER", "transferred_to": ["'"$user2uuid"'"], "transferred_from": ["'"${user2uuid^^}"'" ] } }' > /dev/null

  [[ "$(has_gold "uuid = '$user2uuid'::uuid")" == t ]]
  [[ "$(q "select count(*) from gold_subscription where person_id = (select id from person where uuid = '$user2uuid'::uuid)")" == 1 ]]

  say "A grant only displaces a subscription it outlasts"
  user2_subscription () {
    q "select $1 from gold_subscription where person_id = (select id from person where uuid = '$user2uuid'::uuid)"
  }
  q "update gold_subscription set provider = 'paypal', provider_subscription_id = 'I-1' where person_id = (select id from person where uuid = '$user2uuid'::uuid)"
  set_gold true "uuid = '$user2uuid'::uuid"
  [[ "$(user2_subscription provider)" == paypal ]]
  q "update gold_subscription set expires_at = now() + interval '1 day' where provider = 'paypal'"
  set_gold true "uuid = '$user2uuid'::uuid"
  [[ "$(user2_subscription provider)" == revenuecat ]]
  [[ "$(user2_subscription expires_at)" == infinity ]]

  say "Gold lapses once its subscription expires"
  q "update gold_subscription set expires_at = now() - interval '1 minute' where person_id = (select id from person where uuid = '$user2uuid'::uuid)"

  assert_eventually f has_gold "uuid = '$user2uuid'::uuid"
  assert_eventually 0 q "select count(*) from gold_subscription where person_id = (select id from person where uuid = '$user2uuid'::uuid)"

  say "Unknown/ignored events return 200 and perform no updates"
  pre1=$(has_gold "uuid = '$user1uuid'::uuid")
  pre2=$(has_gold "uuid = '$user2uuid'::uuid")
  export SESSION_TOKEN=""
  c \
    POST \
    /revenuecat \
    --header "Authorization: Bearer valid-revenuecat-token" \
    --header "Content-Type: application/json" \
    -d '{ "event": { "type": "SOME_UNKNOWN_EVENT", "foo": "bar" } }' > /dev/null
  post1=$(has_gold "uuid = '$user1uuid'::uuid")
  post2=$(has_gold "uuid = '$user2uuid'::uuid")
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

  [[ "$(has_gold "uuid = '$useruuid'::uuid")" == f ]]
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
  set_gold false "name = 'rcuser5'"

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

post_purchase () {
  SESSION_TOKEN="" c POST /revenuecat \
    --header "Authorization: Bearer valid-revenuecat-token" \
    --header "Content-Type: application/json" \
    -d '{ "event": {
      "type": "'"$1"'",
      "app_user_id": "'"$2"'",
      "environment": "'"${5:-PRODUCTION}"'",
      "transaction_id": "'"$3"'",
      "original_transaction_id": "original-'"$2"'",
      "product_id": "gold_monthly",
      "purchased_at_ms": 1767225600000,
      "price_in_purchased_currency": '"${4:-9.99}"',
      "currency": "EUR"
    } }' > /dev/null
}

ref_payment () {
  q "select ref || ' ' || plan || ' ' || amount || ' ' || currency || ' ' || paid_at from ref_payment where provider_payment_id = '$1'"
}

payments_are_attributed_to_refs() {
  say "Reset core tables to a clean state"
  q "delete from person"
  q "delete from ref_payment"

  ../util/create-user.sh rcref1 0 0
  ../util/create-user.sh rcref2 0 0
  q "insert into person_ref (person_id, ref) select id, 'partner' from person where email = 'rcref1@example.com'"

  ref_uuid=$(get_uuid 'rcref1@example.com')
  no_ref_uuid=$(get_uuid 'rcref2@example.com')

  say "A free trial grants gold but records no payment"
  post_purchase INITIAL_PURCHASE "$ref_uuid" txn-1 0
  [[ "$(has_gold "uuid = '$ref_uuid'::uuid")" == t ]]
  [[ "$(q "select count(*) from ref_payment")" == 0 ]]

  say "A paid renewal is recorded against the subscriber's ref"
  post_purchase RENEWAL "$ref_uuid" txn-2
  [[ "$(ref_payment txn-2)" == 'partner gold_monthly 9.99 EUR 2026-01-01 00:00:00' ]]

  say "A redelivered event is recorded once"
  post_purchase RENEWAL "$ref_uuid" txn-2
  [[ "$(q "select count(*) from ref_payment")" == 1 ]]

  say "Sandbox purchases and purchases without a ref are not recorded"
  post_purchase RENEWAL "$ref_uuid" txn-3 9.99 SANDBOX
  post_purchase INITIAL_PURCHASE "$no_ref_uuid" txn-4
  [[ "$(q "select count(*) from ref_payment")" == 1 ]]
  [[ "$(has_gold "uuid = '$no_ref_uuid'::uuid")" == t ]]

  say "Renewals after the account is deleted keep the ref"
  assume_role rcref1
  c DELETE /account
  post_purchase RENEWAL "$ref_uuid" txn-5
  [[ "$(ref_payment txn-5)" == 'partner gold_monthly 9.99 EUR 2026-01-01 00:00:00' ]]
}

clean_up () {
  q "select setval(pg_get_serial_sequence('person','id'), 1, true)"
}

has_gold_is_set_by_webhook
expiration_resets_settings
premium_features_require_gold
club_counts_survive_gold_expiry_while_deactivated
payments_are_attributed_to_refs

clean_up
