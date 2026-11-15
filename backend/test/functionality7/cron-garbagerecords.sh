#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from person"
q "delete from duo_session"

../util/create-user.sh user1 0 0

user1id=$(get_id 'user1@example.com')

assume_role user1

q "insert into duo_session (session_token_hash, email)
   values ('no-person', 'nobody@example.com')"

num_sessions=$(q "select count(*) from duo_session where person_id = $user1id and ip_address is not null")
[[ "$num_sessions" -ge 1 ]]
[[ "$(q "select count(*) from duo_session where person_id = $user1id and signed_in")" -ge 1 ]]

q "update duo_session set session_expiry = now() - interval '1 second'"

! c POST /check-session-token || exit 1

assert_eventually 0 q "select count(*) from duo_session where person_id is null"
assert_eventually 0 q "select count(*) from duo_session where signed_in"

[[ "$(q "select count(*) from duo_session where person_id = $user1id and ip_address is not null")" = "$num_sessions" ]]

! c POST /check-session-token || exit 1
