#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

# Clear the result cache so each /public-search call reflects the current
# database rather than a snapshot left by an earlier call or test run.
flush_redis () {
  exec 3<>"/dev/tcp/${DUO_REDIS_HOST:-localhost}/${DUO_REDIS_PORT:-6379}"
  printf 'FLUSHALL\r\n' >&3
  read -r -u 3 -t 5 _reply
  exec 3>&- 3<&-
}

# Anonymous GET /public-search. The cache is flushed first so the result is
# always derived from the current database.
public_search () {
  flush_redis
  SESSION_TOKEN="" c GET "/public-search$1"
}

setup () {
  q "delete from duo_session"
  q "delete from person"
  q "delete from onboardee"
  q "delete from undeleted_photo"

  ../util/create-user.sh user1 0
  ../util/create-user.sh user2 0
  ../util/create-user.sh user3 0

  q "update person set public_profile = true"
}

returns_public_profiles () {
  setup

  j_assert_length "$(public_search)" 3
}

excludes_non_public_profiles () {
  setup

  q "update person set public_profile = false where email = 'user1@example.com'"

  j_assert_length "$(public_search)" 2
}

excludes_deactivated_and_shadow_banned () {
  setup

  q "update person set activated = false where email = 'user1@example.com'"
  q "update person set shadow_banned_at = now() where email = 'user2@example.com'"

  j_assert_length "$(public_search)" 1
}

excludes_long_offline () {
  setup

  q "
    update person
    set last_online_time = now() - interval '8 days'
    where email = 'user1@example.com'"

  j_assert_length "$(public_search)" 2
}

pagination_limits_and_offsets () {
  setup

  j_assert_length "$(public_search '?n=10&o=0')" 3

  local page1=$(public_search '?n=2&o=0')
  j_assert_length "$page1" 2

  local page2=$(public_search '?n=2&o=2')
  j_assert_length "$page2" 1

  # The two pages together cover every profile exactly once.
  local distinct=$(
    echo "$page1 $page2" | jq -s 'add | map(.prospect_uuid) | unique | length'
  )
  [[ "$distinct" -eq 3 ]]
}

defaults_to_first_page () {
  setup

  # No params is equivalent to n=10, o=0.
  local default=$(public_search | jq -S .)
  local explicit=$(public_search '?n=10&o=0' | jq -S .)
  [[ "$default" == "$explicit" ]]
}

rejects_n_above_ten () {
  setup

  ! public_search '?n=11&o=0' || exit 1
}

returns_public_profiles
excludes_non_public_profiles
excludes_deactivated_and_shadow_banned
excludes_long_offline
pagination_limits_and_offsets
defaults_to_first_page
rejects_n_above_ten
