#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from person"
q "delete from duo_session"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0

user1uuid=$(get_uuid 'user1@example.com')
user2uuid=$(get_uuid 'user2@example.com')

relay_send () {
  curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:3001/send?id=$1" \
    -H "Content-Type: application/json" \
    -d "$(chat_message_json "$user1uuid" "$user2uuid" "$2" "$2")"
}

assume_role user1
chat_auth "$user1uuid" "$SESSION_TOKEN" other

echo "Signing out closes the session's chat connection and no other"
assume_role user1
chat_auth "$user1uuid" "$SESSION_TOKEN"
sleep 1
[[ "$(relay_send default before-sign-out)" = 200 ]]
c POST /sign-out
sleep 1
[[ "$(relay_send default after-sign-out)" = 500 ]]
[[ "$(relay_send other other-session-after-sign-out)" = 200 ]]

echo "Deactivating closes every chat connection of the person's sessions"
assume_role user1
chat_auth "$user1uuid" "$SESSION_TOKEN"
sleep 1
[[ "$(relay_send default before-deactivating)" = 200 ]]
c POST /deactivate
sleep 1
[[ "$(relay_send default after-deactivating)" = 500 ]]
[[ "$(relay_send other other-session-after-deactivating)" = 500 ]]
