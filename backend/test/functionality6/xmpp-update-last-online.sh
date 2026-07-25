#!/usr/bin/env bash

# Purpose: Ensure that a fresh sign-in resets `seconds_since_last_online` in the
# `/prospect-profile/$uuid` response.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

sleep 3 # Allow services to flush startup tasks

# ---------------------------------------------------------------------------
# Test set-up – wipe relevant tables and create two users
# ---------------------------------------------------------------------------
q "delete from person"
q "delete from club"
q "delete from duo_session"

../util/create-user.sh viewer 0 0   # User that will view the profile
../util/create-user.sh target 0 0   # User whose profile we'll view

q "update person set privacy_verification_level_id = 1, hide_me_from_strangers = false"

assume_role target ; target_token=$SESSION_TOKEN
target_uuid=$(get_uuid 'target@example.com')

sleep 2
q "
update person
set
  sign_in_time = now() - interval '2 hours',
  last_online_time = to_timestamp(0)
where uuid     = '${target_uuid}'"

# ---------------------------------------------------------------------------
# 1) Query profile before new login – expect a large value (≈7200 seconds)
# ---------------------------------------------------------------------------
assume_role viewer

old_secs=$( c GET "/prospect-profile/${target_uuid}" | jq '.seconds_since_last_online' )

# Sanity: ensure it's at least 3500 seconds (≈1 h)
[[ $old_secs -ge 3500 ]]

# ---------------------------------------------------------------------------
# 2) Sign-in again as target which should reset `sign_in_time` to NOW
# ---------------------------------------------------------------------------
chat_auth "$target_uuid" "$target_token"

sleep 1   # small delay to allow DB commit

# ---------------------------------------------------------------------------
# 3) Query profile again – expect the value to be small (< 30 seconds)
# ---------------------------------------------------------------------------
new_secs=$( c GET "/prospect-profile/${target_uuid}" | jq '.seconds_since_last_online' )

[[ $new_secs -le 30 ]]

# Ensure it actually decreased
[[ $new_secs -lt $old_secs ]]

# ---------------------------------------------------------------------------
# 4) With `show_my_online_status = false`, the last-online time is hidden
# ---------------------------------------------------------------------------
q "update person set show_my_online_status = false where uuid = '${target_uuid}'"

hidden_secs=$( c GET "/prospect-profile/${target_uuid}" | jq '.seconds_since_last_online' )

[[ $hidden_secs == null ]]

