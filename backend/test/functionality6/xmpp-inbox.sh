#!/usr/bin/env bash

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

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0
../util/create-user.sh user3 0 0

assume_role user1 ; user1token=$SESSION_TOKEN
assume_role user2 ; user2token=$SESSION_TOKEN
assume_role user3 ; user3token=$SESSION_TOKEN

user1uuid=$(get_uuid 'user1@example.com')
user2uuid=$(get_uuid 'user2@example.com')
user3uuid=$(get_uuid 'user3@example.com')

user1id=$(get_id 'user1@example.com')
user2id=$(get_id 'user2@example.com')
user3id=$(get_id 'user3@example.com')

get_inbox () {
  local userUuid=$1
  local userToken=$2

  chat_auth "$userUuid" "$userToken"

  sleep 1

  curl -sX GET http://localhost:3001/pop > /dev/null
  sleep 0.5

  curl -X POST http://localhost:3001/send \
    -H "Content-Type: application/json" \
    -d '{ "duo_query_inbox": null }'
  sleep 1

  curl -sX GET http://localhost:3001/pop \
    | jq -sS -c '
      [.[] | .duo_inbox | select(. != null)][0].conversations
      | map({name, last_message, last_message_read, location})
      | sort_by(.name)
    '

  sleep 1
}

mark_displayed () {
  local fromUuid=$1
  local fromToken=$2
  local toUuid=$3

  chat_auth "$fromUuid" "$fromToken"

  sleep 1

  read -r -d '' query <<EOF || true
{
  "message": {
    "@to": "${toUuid}@duolicious.app",
    "@from": "${fromUuid}@duolicious.app",
    "displayed": {
      "@xmlns": "urn:xmpp:chat-markers:0",
      "@id": "id1"
    }
  }
}
EOF

  curl -X POST http://localhost:3001/send -H "Content-Type: application/json" -d "$query"
  sleep 1
}

conversation_with () {
  jq -c --arg name "$1" '.[] | select(.name == $name)'
}


echo "The inbox is as expected after users message each other"

# Who messaged who:
# ┌───┐            ┌───┐
# │ 1 │◄───────────│ 2 │
# └───┘     ┌─────►└─┬─┘
#    ▲    ┌─┴─┐      │
#    └────┤ 3 │◄─────┘
#         └───┘
send_message "$user2uuid" "$user2token" "$user1uuid" "from user 2 to user 1"
sleep 1
send_message "$user2uuid" "$user2token" "$user3uuid" "from user 2 to user 3"
sleep 1

send_message "$user3uuid" "$user3token" "$user1uuid" "from user 3 to user 1"
sleep 1
send_message "$user3uuid" "$user3token" "$user2uuid" "from user 3 to user 2"
sleep 1

inbox_1=$(get_inbox "$user1uuid" "$user1token")
inbox_2=$(get_inbox "$user2uuid" "$user2token")
inbox_3=$(get_inbox "$user3uuid" "$user3token")

[[ "$(jq length <<< "$inbox_1")" == 2 ]]
[[ "$(conversation_with user2 <<< "$inbox_1")" == '{"last_message":"from user 2 to user 1","last_message_read":false,"location":"intros","name":"user2"}' ]]
[[ "$(conversation_with user3 <<< "$inbox_1")" == '{"last_message":"from user 3 to user 1","last_message_read":false,"location":"intros","name":"user3"}' ]]
[[ "$(conversation_with user3 <<< "$inbox_2")" == '{"last_message":"from user 3 to user 2","last_message_read":false,"location":"chats","name":"user3"}' ]]
[[ "$(conversation_with user2 <<< "$inbox_3")" == '{"last_message":"from user 3 to user 2","last_message_read":true,"location":"chats","name":"user2"}' ]]

echo "The direction column is forward-filled when users message each other"

# Every inbox row the chat service writes should now carry a direction.
null_directions=$(q "select count(*) from inbox where direction is null")
[[ "$null_directions" == "0" ]] || { echo "Expected no null directions, found $null_directions"; exit 1; }

# user1 only ever received messages, so both of their rows are incoming ('I').
user1_incoming=$(q "select count(*) from inbox where luser = '${user1uuid}' and direction = 'I'")
[[ "$user1_incoming" == "2" ]] || { echo "Expected user1 to have 2 incoming rows, got $user1_incoming"; exit 1; }

user1_outgoing=$(q "select count(*) from inbox where luser = '${user1uuid}' and direction = 'O'")
[[ "$user1_outgoing" == "0" ]] || { echo "Expected user1 to have 0 outgoing rows, got $user1_outgoing"; exit 1; }

# The sender's own copy of a message is outgoing ('O').
u2_to_u1_direction=$(q "select direction from inbox where luser = '${user2uuid}' and remote_bare_jid = '${user1uuid}@duolicious.app'")
[[ "$u2_to_u1_direction" == "O" ]] || { echo "Expected user2's row about user1 to be outgoing, got '$u2_to_u1_direction'"; exit 1; }

echo "Marking a message displayed updates the inbox"

mark_displayed "$user1uuid" "$user1token" "$user2uuid"

inbox_1=$(get_inbox "$user1uuid" "$user1token")

[[ "$(conversation_with user2 <<< "$inbox_1")" == '{"last_message":"from user 2 to user 1","last_message_read":true,"location":"intros","name":"user2"}' ]]
[[ "$(conversation_with user3 <<< "$inbox_1")" == '{"last_message":"from user 3 to user 1","last_message_read":false,"location":"intros","name":"user3"}' ]]
