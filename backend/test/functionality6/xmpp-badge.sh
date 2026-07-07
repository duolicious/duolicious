#!/usr/bin/env bash

# Purpose: The iOS app-icon badge is `person.unseen_notification_count`,
# stamped into each push as an absolute `badge` value. Verify that:
#   1. Pushes sent while the user has no connected chat clients increment the
#      count, and each push carries the incremented value.
#   2. Connecting any chat client zeroes the count.
#   3. Pushes sent while any client is connected neither increment the count
#      nor carry a badge (which leaves each device's badge untouched).
#   4. Once the last client disconnects, pushes increment the count again.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

sleep 3 # MongooseIM takes some time to flush messages to the DB

q "delete from person"
q "delete from banned_person"
q "delete from banned_person_admin_token"
q "delete from duo_session"
q "delete from mam_message"
q "delete from inbox"
q "delete from intro_hash"

# Authenticate a named, persistent websocket connection. Unlike `chat_auth`,
# which reuses (and so re-opens) the 'default' connection, a named connection
# survives other users' `chat_auth` calls, keeping its user online.
chat_auth_as () {
  local connectionId=$1
  local fromUuid=$2
  local fromToken=$3

  local auth64=$(printf '\0%s\0%s' "$fromUuid" "$fromToken" | base64 -w 0)

  read -r -d '' authJson <<EOF || true
{
  "auth": {
    "@xmlns": "urn:ietf:params:xml:ns:xmpp-sasl",
    "@mechanism": "PLAIN",
    "#text": "${auth64}"
  }
}
EOF

  curl -sX POST "http://localhost:3001/config?id=${connectionId}" \
    -H "Content-Type: application/json" \
    -d '{ "server": "ws://chat:5443" }'

  sleep 0.2

  curl -sX POST "http://localhost:3001/send?id=${connectionId}" \
    -H "Content-Type: application/json" \
    -d "$authJson"

  sleep 1
}

disconnect_connection () {
  local connectionId=$1

  curl -sX POST "http://localhost:3001/disconnect?id=${connectionId}"

  sleep 2
}

send_message () {
  local fromUuid=$1
  local fromToken=$2
  local toUuid=$3
  local message=$4
  local id=$5

  chat_auth "$fromUuid" "$fromToken"

  sleep 1

  read -r -d '' payload <<EOF || true
{
  "message": {
    "@type": "chat",
    "@from": "${fromUuid}@duolicious.app",
    "@to": "${toUuid}@duolicious.app",
    "@id": "${id}",
    "@xmlns": "jabber:client",
    "body": "${message}",
    "request": {
      "@xmlns": "urn:xmpp:receipts"
    }
  }
}
EOF

  curl -X POST http://localhost:3001/send -H "Content-Type: application/json" -d "$payload"
  sleep 3
}

# Send a <duo_register_push_token token='…'/> for the authenticated session.
register_push_token () {
  local fromUuid=$1
  local fromToken=$2
  local token=$3

  chat_auth "$fromUuid" "$fromToken"

  sleep 1

  read -r -d '' payload <<EOF || true
{ "duo_register_push_token": { "@token": "${token}" } }
EOF

  curl -X POST http://localhost:3001/send -H "Content-Type: application/json" -d "$payload"
  sleep 1.5
}

unseen_count () {
  local uuid=$1

  q "select unseen_notification_count from person where uuid::text = '${uuid}'"
}


../util/create-user.sh alice 0 0
../util/create-user.sh bob 0 0

# Bob gets immediate notifications so the live push path fires on each message.
q "update person
   set intros_notification = 1, chats_notification = 1,
       intro_seconds = 0, chat_seconds = 0
   where email = 'bob@example.com'"

assume_role alice ; alicetoken=$SESSION_TOKEN
aliceuuid=$(get_uuid 'alice@example.com')

unset SESSION_TOKEN
assume_role bob ; bobtoken=$SESSION_TOKEN
bobuuid=$(get_uuid 'bob@example.com')

# Bob registers a push token, then that session is made the most recent so the
# live push targets it rather than deferring to the cron's web-client email.
register_push_token "$bobuuid" "$bobtoken" 'bob-token'
q "update duo_session set last_online_time = now() where push_token = 'bob-token'"

# Bob messages Alice first so Alice's replies are chats, which dodges the
# intro-only rate limiting and uniqueness checks on repeated messages.
send_message "$bobuuid" "$bobtoken" "$aliceuuid" "hi alice" "id-bob-1"

clear_pushes



echo 'Pushes to a user with no connected clients increment the badge'

# Authenticating as Alice reused the default connection, closing Bob's, so Bob
# has no connected clients when these pushes are sent.
send_message "$aliceuuid" "$alicetoken" "$bobuuid" "reply one" "id-alice-1"

[[ "$(unseen_count "$bobuuid")" = 1 ]]
[[ "$(badges_of_pushes_to 'bob-token')" = '[1]' ]]

send_message "$aliceuuid" "$alicetoken" "$bobuuid" "reply two" "id-alice-2"

[[ "$(unseen_count "$bobuuid")" = 2 ]]
[[ "$(badges_of_pushes_to 'bob-token')" = '[1,2]' ]]



echo 'Connecting any client zeroes the count'

chat_auth_as bob-client "$bobuuid" "$bobtoken"

[[ "$(unseen_count "$bobuuid")" = 0 ]]



echo 'Pushes sent while a client is connected are badge-less and do not increment'

# Bob stays connected on the named connection while Alice authenticates on the
# default one.
send_message "$aliceuuid" "$alicetoken" "$bobuuid" "reply three" "id-alice-3"

[[ "$(unseen_count "$bobuuid")" = 0 ]]
[[ "$(badges_of_pushes_to 'bob-token')" = '[1,2,null]' ]]



echo 'Once the last client disconnects, pushes increment the count again'

disconnect_connection bob-client

send_message "$aliceuuid" "$alicetoken" "$bobuuid" "reply four" "id-alice-4"

[[ "$(unseen_count "$bobuuid")" = 1 ]]
[[ "$(badges_of_pushes_to 'bob-token')" = '[1,2,null,1]' ]]
