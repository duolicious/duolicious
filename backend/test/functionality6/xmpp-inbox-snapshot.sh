#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

sleep 3 # The chat service takes some time to flush messages to the DB

q "delete from person"
q "delete from banned_person"
q "delete from banned_person_admin_token"
q "delete from duo_session"
q "delete from mam_message"
q "delete from inbox"
q "delete from intro_hash"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 1

assume_role user1 ; user1token=$SESSION_TOKEN
assume_role user2 ; user2token=$SESSION_TOKEN

user1uuid=$(get_uuid 'user1@example.com')
user2uuid=$(get_uuid 'user2@example.com')

user1id=$(get_id 'user1@example.com')
user2id=$(get_id 'user2@example.com')

q "update photo set uuid = 'my-photo-uuid', blurhash = 'my-blurhash'"

# Like setup.sh's chat_auth, but on a named harness connection so that several
# users can be online at once.
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

  curl -X POST "http://localhost:3001/config?id=${connectionId}" \
    -H "Content-Type: application/json" \
    -d '{ "server": "ws://chat:5443" }'

  sleep 0.2

  curl -X POST "http://localhost:3001/send?id=${connectionId}" \
    -H "Content-Type: application/json" \
    -d "$authJson"

  sleep 1

  curl -sX GET "http://localhost:3001/pop?id=${connectionId}" > /dev/null
}

send_message () {
  local connectionId=$1
  local fromUuid=$2
  local toUuid=$3
  local message=$4

  read -r -d '' payload <<EOF || true
{
  "message": {
    "@type": "chat",
    "@from": "${fromUuid}@duolicious.app",
    "@to": "${toUuid}@duolicious.app",
    "@id": "id1",
    "@xmlns": "jabber:client",
    "body": "${message}",
    "request": {
      "@xmlns": "urn:xmpp:receipts"
    }
  }
}
EOF

  curl -X POST "http://localhost:3001/send?id=${connectionId}" \
    -H "Content-Type: application/json" \
    -d "$payload"

  # Wait for the message store to flush and the inbox entry to be pushed
  sleep 2
}

query_inbox_snapshot () {
  local connectionId=$1

  curl -sX GET "http://localhost:3001/pop?id=${connectionId}" > /dev/null
  sleep 0.5

  curl -X POST "http://localhost:3001/send?id=${connectionId}" \
    -H "Content-Type: application/json" \
    -d '{ "duo_query_inbox": null }'

  sleep 1

  curl -sX GET "http://localhost:3001/pop?id=${connectionId}"
}

# Extracts the conversations from a popped `duo_inbox` stanza, redacting the
# unstable fields.
snapshot_conversations () {
  jq -sS -r '
    [.[] | .duo_inbox | select(. != null)][0]
    | .conversations
    | map(del(.url_slug) | .last_message_timestamp = "redacted")
  '
}

chat_auth_as user1 "$user1uuid" "$user1token"
chat_auth_as user2 "$user2uuid" "$user2token"


echo "A message pushes a complete inbox entry to the recipient, before the message"

send_message user2 "$user2uuid" "$user1uuid" "intro from user 2"

received_1=$(curl -sX GET "http://localhost:3001/pop?id=user1")

actual_stanza_order=$(jq -s -r '[.[] | keys[0]] | join(",")' <<< "$received_1")
[[ "$actual_stanza_order" == "duo_inbox_entry,message" ]] \
  || { echo "Expected an inbox entry then a message, got '$actual_stanza_order'"; exit 1; }

actual_entry=$(jq -sS -r '
  [.[] | .duo_inbox_entry | select(. != null)][0]
  | del(.url_slug)
  | .last_message_timestamp = "redacted"
' <<< "$received_1")

expected_entry=$(cat << EOF
{
  "image_blurhash": "my-blurhash",
  "image_uuid": "my-photo-uuid",
  "is_available": true,
  "is_verified": false,
  "last_message": "intro from user 2",
  "last_message_read": false,
  "last_message_timestamp": "redacted",
  "location": "intros",
  "match_percentage": 50,
  "matches_search_filters": true,
  "name": "user2",
  "person_uuid": "${user2uuid}"
}
EOF
)

diff -u --color <(echo "$actual_entry") <(jq -S . <<< "$expected_entry")


echo "The inbox snapshot returns the same complete conversation"

actual_snapshot=$(query_inbox_snapshot user1 | snapshot_conversations)

diff -u --color \
  <(echo "$actual_snapshot") \
  <(jq -S '[.]' <<< "$expected_entry")

actual_snapshot=$(query_inbox_snapshot user2 | snapshot_conversations)

diff -u --color \
  <(echo "$actual_snapshot") \
  <(jq -S . <<< '[]')


echo "An intro from a sender outside the viewer's search filters is flagged"

q "update search_preference_age set min_age = 90, max_age = 99 where person_id = ${user1id}"

actual_snapshot=$(query_inbox_snapshot user1 | snapshot_conversations)

diff -u --color \
  <(echo "$actual_snapshot") \
  <(jq -S '[. | .matches_search_filters = false]' <<< "$expected_entry")

q "update search_preference_age set min_age = null, max_age = null where person_id = ${user1id}"

actual_snapshot=$(query_inbox_snapshot user1 | snapshot_conversations)

diff -u --color <(echo "$actual_snapshot") <(jq -S '[.]' <<< "$expected_entry")


echo "A reply moves the conversation to chats on both sides"

send_message user1 "$user1uuid" "$user2uuid" "reply from user 1"

received_2=$(curl -sX GET "http://localhost:3001/pop?id=user2")

actual_entry=$(jq -sS -r '
  [.[] | .duo_inbox_entry | select(. != null)][0]
  | del(.url_slug)
  | .last_message_timestamp = "redacted"
' <<< "$received_2")

expected_entry=$(cat << EOF
{
  "image_blurhash": null,
  "image_uuid": null,
  "is_available": true,
  "is_verified": false,
  "last_message": "reply from user 1",
  "last_message_read": false,
  "last_message_timestamp": "redacted",
  "location": "chats",
  "match_percentage": 50,
  "matches_search_filters": true,
  "name": "user1",
  "person_uuid": "${user1uuid}"
}
EOF
)

diff -u --color <(echo "$actual_entry") <(jq -S . <<< "$expected_entry")

actual_snapshot=$(query_inbox_snapshot user1 | snapshot_conversations)

expected_snapshot=$(cat << EOF
[
  {
    "image_blurhash": "my-blurhash",
    "image_uuid": "my-photo-uuid",
    "is_available": true,
    "is_verified": false,
    "last_message": "reply from user 1",
    "last_message_read": true,
    "last_message_timestamp": "redacted",
    "location": "chats",
    "match_percentage": 50,
    "matches_search_filters": true,
    "name": "user2",
    "person_uuid": "${user2uuid}"
  }
]
EOF
)

diff -u --color <(echo "$actual_snapshot") <(jq -S . <<< "$expected_snapshot")


echo "Being skipped hides the skipper's info and archives the conversation"

q "insert into skipped values (${user2id}, ${user1id}, false)"

actual_snapshot=$(query_inbox_snapshot user1 | snapshot_conversations)

expected_snapshot=$(cat << EOF
[
  {
    "image_blurhash": null,
    "image_uuid": null,
    "is_available": false,
    "is_verified": false,
    "last_message": "reply from user 1",
    "last_message_read": true,
    "last_message_timestamp": "redacted",
    "location": "archive",
    "match_percentage": null,
    "matches_search_filters": true,
    "name": null,
    "person_uuid": "${user2uuid}"
  }
]
EOF
)

diff -u --color <(echo "$actual_snapshot") <(jq -S . <<< "$expected_snapshot")
