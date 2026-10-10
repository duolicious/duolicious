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
    -d '{ "server": "ws://api:5000/chat" }'

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
  "awaiting_reply": false,
  "location": "intros",
  "hidden": false,
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

q "update search_preference set min_age = 90, max_age = 99 where person_id = ${user1id}"

actual_snapshot=$(query_inbox_snapshot user1 | snapshot_conversations)

diff -u --color \
  <(echo "$actual_snapshot") \
  <(jq -S '[. | .matches_search_filters = false]' <<< "$expected_entry")

q "update search_preference set min_age = null, max_age = null where person_id = ${user1id}"

actual_snapshot=$(query_inbox_snapshot user1 | snapshot_conversations)

diff -u --color <(echo "$actual_snapshot") <(jq -S '[.]' <<< "$expected_entry")


echo "An intro whose sender's own filters exclude a two-way viewer is flagged"

# The sender (user2) only wants to see 90-99 year olds, which excludes the
# ~26yo viewer (user1).
q "update search_preference set min_age = 90, max_age = 99 where person_id = ${user2id}"

# One-way (default): the sender's own age filter is ignored, so still matches.
actual_snapshot=$(query_inbox_snapshot user1 | snapshot_conversations)
diff -u --color <(echo "$actual_snapshot") <(jq -S '[.]' <<< "$expected_entry")

# Turn the viewer's age filter two-way.
assume_role user1
jc POST /search-filter -d '{ "two_way_filters": { "age": true } }'

actual_snapshot=$(query_inbox_snapshot user1 | snapshot_conversations)
diff -u --color \
  <(echo "$actual_snapshot") \
  <(jq -S '[. | .matches_search_filters = false]' <<< "$expected_entry")

jc POST /search-filter -d '{ "two_way_filters": { "age": false } }'
q "update search_preference set min_age = null, max_age = null where person_id = ${user2id}"

actual_snapshot=$(query_inbox_snapshot user1 | snapshot_conversations)
diff -u --color <(echo "$actual_snapshot") <(jq -S '[.]' <<< "$expected_entry")


echo "An intro from a sender last online over a month ago is archived"

q "update person set last_online_time = now() - interval '2 months' where id = ${user2id}"

actual_snapshot=$(query_inbox_snapshot user1 | snapshot_conversations)

diff -u --color \
  <(echo "$actual_snapshot") \
  <(jq -S '[. | .location = "archive"]' <<< "$expected_entry")

q "update person set last_online_time = now() where id = ${user2id}"

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
  "awaiting_reply": false,
  "location": "chats",
  "hidden": false,
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
    "awaiting_reply": false,
    "location": "chats",
    "hidden": false,
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
    "awaiting_reply": false,
    "location": "archive",
    "hidden": false,
    "match_percentage": null,
    "matches_search_filters": true,
    "name": null,
    "person_uuid": "${user2uuid}"
  }
]
EOF
)

diff -u --color <(echo "$actual_snapshot") <(jq -S . <<< "$expected_snapshot")


echo "A shadow-banned partner is anonymised and archived, like a skipped one"

q "delete from skipped"
q "update person set shadow_banned_at = now() where id = ${user2id}"

actual_snapshot=$(query_inbox_snapshot user1 | snapshot_conversations)

diff -u --color <(echo "$actual_snapshot") <(jq -S . <<< "$expected_snapshot")


echo "A chat with a partner last online over a month ago is archived, info intact"

q "update person set shadow_banned_at = null where id = ${user2id}"
q "update person set last_online_time = now() - interval '2 months' where id = ${user2id}"

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
    "awaiting_reply": false,
    "location": "archive",
    "hidden": false,
    "match_percentage": 50,
    "matches_search_filters": true,
    "name": "user2",
    "person_uuid": "${user2uuid}"
  }
]
EOF
)

diff -u --color <(echo "$actual_snapshot") <(jq -S . <<< "$expected_snapshot")

q "update person set last_online_time = now() where id = ${user2id}"

actual_snapshot=$(query_inbox_snapshot user1 | snapshot_conversations)

diff -u --color \
  <(echo "$actual_snapshot") \
  <(jq -S '[.[0] | .location = "chats"]' <<< "$expected_snapshot")


echo "The delivered stamp matches the inbox timestamp everywhere it appears"

curl -sX GET "http://localhost:3001/pop?id=user2" > /dev/null

send_message user2 "$user2uuid" "$user1uuid" "stamped message"

delivered_stamp=$(curl -sX GET "http://localhost:3001/pop?id=user2" \
  | jq -s -r '[.[] | .duo_message_delivered | select(. != null)][0]["@stamp"]')

entry_timestamp=$(curl -sX GET "http://localhost:3001/pop?id=user1" \
  | jq -s -r '[.[] | .duo_inbox_entry | select(. != null)][0].last_message_timestamp')

snapshot_timestamp=$(query_inbox_snapshot user1 \
  | jq -s -r '
      [.[] | .duo_inbox | select(. != null)][0]
      | .conversations[0].last_message_timestamp
    ')

[[ -n "$delivered_stamp" && "$delivered_stamp" != "null" ]] \
  || { echo "Missing delivered stamp"; exit 1; }
[[ "$entry_timestamp" == "$delivered_stamp" ]] \
  || { echo "Entry timestamp '$entry_timestamp' != stamp '$delivered_stamp'"; exit 1; }
[[ "$snapshot_timestamp" == "$delivered_stamp" ]] \
  || { echo "Snapshot timestamp '$snapshot_timestamp' != stamp '$delivered_stamp'"; exit 1; }


echo "Sent messages in Chats trial: arms are assigned by person ID"

next_person_id=$(q "select last_value + 1 from person_id_seq")

q "select setval('person_id_seq', 390250, false)"
../util/create-user.sh treated 0 0
q "select setval('person_id_seq', 390251, false)"
../util/create-user.sh control 0 0
q "select setval('person_id_seq', ${next_person_id}, false)"

assume_role treated ; treatedtoken=$SESSION_TOKEN
assume_role control ; controltoken=$SESSION_TOKEN

treateduuid=$(get_uuid 'treated@example.com')
controluuid=$(get_uuid 'control@example.com')

[[ "$(get_id 'treated@example.com')" == 390250 ]]
[[ "$(get_id 'control@example.com')" == 390251 ]]

chat_auth_as treated "$treateduuid" "$treatedtoken"
chat_auth_as control "$controluuid" "$controltoken"

curl -sX GET "http://localhost:3001/pop?id=user1" > /dev/null


echo "Sent messages in Chats trial: the treated arm's first message is pushed to it as a chat"

send_message treated "$treateduuid" "$user1uuid" "unreplied from treated"

received=$(curl -sX GET "http://localhost:3001/pop?id=treated")

actual_stanza_order=$(jq -s -r '[.[] | keys[0]] | join(",")' <<< "$received")
[[ "$actual_stanza_order" == "duo_inbox_entry,duo_message_delivered" ]] \
  || { echo "Expected an inbox entry then a receipt, got '$actual_stanza_order'"; exit 1; }

actual_entry=$(jq -sS -r '
  [.[] | .duo_inbox_entry | select(. != null)][0]
  | del(.url_slug)
  | .last_message_timestamp = "redacted"
' <<< "$received")

expected_entry=$(cat << EOF2
{
  "image_blurhash": null,
  "image_uuid": null,
  "is_available": true,
  "is_verified": false,
  "last_message": "unreplied from treated",
  "last_message_read": true,
  "last_message_timestamp": "redacted",
  "awaiting_reply": true,
  "location": "chats",
  "hidden": false,
  "match_percentage": 50,
  "matches_search_filters": true,
  "name": "user1",
  "person_uuid": "${user1uuid}"
}
EOF2
)

diff -u --color <(echo "$actual_entry") <(jq -S . <<< "$expected_entry")

actual_snapshot=$(query_inbox_snapshot treated | snapshot_conversations)
diff -u --color <(echo "$actual_snapshot") <(jq -S '[.]' <<< "$expected_entry")


echo "Sent messages in Chats trial: the control arm's unreplied conversation stays hidden"

send_message control "$controluuid" "$user1uuid" "unreplied from control"

received=$(curl -sX GET "http://localhost:3001/pop?id=control")

actual_stanza_order=$(jq -s -r '[.[] | keys[0]] | join(",")' <<< "$received")
[[ "$actual_stanza_order" == "duo_message_delivered" ]] \
  || { echo "Expected only a receipt, got '$actual_stanza_order'"; exit 1; }

actual_snapshot=$(query_inbox_snapshot control | snapshot_conversations)
diff -u --color <(echo "$actual_snapshot") <(jq -S . <<< '[]')


echo "Sent messages in Chats trial: the recipient sees both as intros, whatever its own arm"

actual_locations=$(query_inbox_snapshot user1 | jq -s -r '
  [.[] | .duo_inbox | select(. != null)][0]
  | .conversations
  | map(select(.name == "treated" or .name == "control") | "\(.name):\(.location)")
  | sort
  | join(",")
')
[[ "$actual_locations" == "control:intros,treated:intros" ]] \
  || { echo "Unexpected recipient locations '$actual_locations'"; exit 1; }


echo "Sent messages in Chats trial: an unreplied conversation with an inactive person is archived"

q "update person set last_online_time = now() - interval '2 months' where id = ${user1id}"

actual_snapshot=$(query_inbox_snapshot treated | snapshot_conversations)
diff -u --color \
  <(echo "$actual_snapshot") \
  <(jq -S '[. | .location = "archive"]' <<< "$expected_entry")

q "update person set last_online_time = now() where id = ${user1id}"


echo "Sent messages in Chats trial: a reply stops the treated arm's conversation awaiting one"

send_message user1 "$user1uuid" "$treateduuid" "reply to treated"

actual_entry=$(curl -sX GET "http://localhost:3001/pop?id=treated" | jq -sS -r '
  [.[] | .duo_inbox_entry | select(. != null)][0]
  | {awaiting_reply, location, last_message}
')

expected_fields='{
  "awaiting_reply": false,
  "last_message": "reply to treated",
  "location": "chats"
}'

diff -u --color <(echo "$actual_entry") <(jq -S . <<< "$expected_fields")


echo "Sent messages in Chats trial: after a reply, the treated arm gets no extra inbox entry"

send_message treated "$treateduuid" "$user1uuid" "second from treated"

received=$(curl -sX GET "http://localhost:3001/pop?id=treated")

actual_stanza_order=$(jq -s -r '[.[] | keys[0]] | join(",")' <<< "$received")
[[ "$actual_stanza_order" == "duo_message_delivered" ]] \
  || { echo "Expected only a receipt, got '$actual_stanza_order'"; exit 1; }

actual_snapshot=$(query_inbox_snapshot treated | snapshot_conversations)
diff -u --color \
  <(echo "$actual_snapshot") \
  <(jq -S '[. | .last_message = "second from treated" | .awaiting_reply = false]' <<< "$expected_entry")
