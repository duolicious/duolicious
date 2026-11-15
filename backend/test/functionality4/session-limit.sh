#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from person"
q "delete from duo_session"

../util/create-user.sh user1 0 0

user1id=$(q "select id from person where email = 'user1@example.com'")

seed_sessions () {
  local num_signed_in=$1

  q "delete from duo_session where person_id = $user1id"

  q "insert into duo_session
       (session_token_hash, person_id, email, signed_in, last_online_time)
     select 'seed-' || g, $user1id, 'user1@example.com', true,
            now() - (g || ' minutes')::interval
     from generate_series(1, $num_signed_in) g"

  q "insert into duo_session
       (session_token_hash, person_id, email, last_online_time)
     select 'out-' || g, $user1id, 'user1@example.com',
            now() - (g || ' seconds')::interval
     from generate_series(1, 20) g"
}

seed_sessions 90

assume_role user1

# Signing in trims the person to MAX_SESSIONS (current session + 99 others),
# deleting the least-recently-active signed-out sessions first.
[[ "$(q "select count(*) from duo_session where person_id = $user1id")" = 100 ]]
[[ "$(q "select count(*) from duo_session where person_id = $user1id and signed_in")" = 91 ]]
[[ "$(q "select count(*) from duo_session where session_token_hash = 'seed-90'")" = 1 ]]
[[ "$(q "select count(*) from duo_session where session_token_hash = 'out-9'")" = 1 ]]
[[ "$(q "select count(*) from duo_session where session_token_hash = 'out-10'")" = 0 ]]

seed_sessions 150

[[ "$(q "select count(*) from duo_session where person_id = $user1id and signed_in")" = 150 ]]

assume_role user1

[[ "$(q "select count(*) from duo_session where person_id = $user1id")" = 100 ]]
[[ "$(q "select count(*) from duo_session where person_id = $user1id and signed_in")" = 100 ]]

# Newest seeded sessions kept, oldest signed out, boundary at 99 others.
[[ "$(q "select count(*) from duo_session where session_token_hash = 'seed-1'")" = 1 ]]
[[ "$(q "select count(*) from duo_session where session_token_hash = 'seed-99'")" = 1 ]]
[[ "$(q "select count(*) from duo_session where session_token_hash = 'seed-100'")" = 0 ]]
[[ "$(q "select count(*) from duo_session where session_token_hash = 'seed-150'")" = 0 ]]
[[ "$(q "select count(*) from duo_session where session_token_hash = 'out-1'")" = 0 ]]

# The session we just signed in with survived and still authenticates.
c POST /check-session-token > /dev/null
