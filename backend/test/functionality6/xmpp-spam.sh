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

# Authenticate as the sender then deliver a chat message over the JSON
# subprotocol. Equivalent to the XML:
#   <message type='chat' from='…' to='…' id='id1' xmlns='jabber:client'>
#     <body>…</body><request xmlns='urn:xmpp:receipts'/>
#   </message>
send_message () {
  local fromUuid=$1
  local fromToken=$2
  local toUuid=$3
  local message=$4

  chat_auth "$fromUuid" "$fromToken"

  sleep 1

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

  curl -X POST http://localhost:3001/send -H "Content-Type: application/json" -d "$payload"
}

# Assert that at least one popped stanza satisfies the jq boolean expression,
# where each stanza is bound to `.`. Reads the popped output from stdin.
assert_any () {
  jq -se "any(.[]; $1)" > /dev/null
}


sleep 3


echo A potential spam message is blocked

send_message "$user1uuid" "$user1token" "$user2uuid" "You should join discord.gg/spaghetti"

sleep 3 # MongooseIM takes some time to flush messages to the DB

[[ "$(q "select count(*) from messaged where \
    subject_person_id = $user1id and \
    object_person_id = $user2id")" = 0 ]]
[[ "$(q "select count(*) from messaged")" = 0 ]]

curl -sX GET http://localhost:3001/pop \
  | assert_any 'has("duo_message_blocked")
      and .duo_message_blocked["@id"] == "id1"
      and .duo_message_blocked["@reason"] == "spam"'

[[ "$(q "select count(*) from mam_message")" = 0 ]]



echo A benign message is allowed

send_message "$user1uuid" "$user1token" "$user2uuid" "damn I want to volunteer to walk puppies"

sleep 3 # MongooseIM takes some time to flush messages to the DB

[[ "$(q "select count(*) from messaged where \
    subject_person_id = $user1id and \
    object_person_id = $user2id")" = 1 ]]
[[ "$(q "select count(*) from messaged")" = 1 ]]

curl -sX GET http://localhost:3001/pop \
  | assert_any 'has("duo_message_delivered") and .duo_message_delivered["@id"] == "id1"'

[[ "$(q "select count(*) from mam_message")" = 2 ]]



echo Potential spam messages are allowed during established conversations

send_message "$user2uuid" "$user2token" "$user1uuid" "You should join discord.gg/spaghetti"

sleep 3 # MongooseIM takes some time to flush messages to the DB

[[ "$(q "select count(*) from messaged where \
    subject_person_id = $user2id and \
    object_person_id = $user1id")" = 1 ]]
[[ "$(q "select count(*) from messaged")" = 2 ]]

curl -sX GET http://localhost:3001/pop \
  | assert_any 'has("duo_message_delivered") and .duo_message_delivered["@id"] == "id1"'

[[ "$(q "select count(*) from mam_message")" = 4 ]]



echo A potential spam message is allowed for trusted accounts

q "update person set sign_up_time = now() - interval '7 days' where uuid = '$user3uuid'"

send_message "$user3uuid" "$user3token" "$user2uuid" "You should also join discord.gg/spaghetti"

sleep 3 # MongooseIM takes some time to flush messages to the DB

[[ "$(q "select count(*) from messaged where \
    subject_person_id = $user3id and \
    object_person_id = $user2id")" = 1 ]]
[[ "$(q "select count(*) from messaged")" = 3 ]]

curl -sX GET http://localhost:3001/pop \
  | assert_any 'has("duo_message_delivered") and .duo_message_delivered["@id"] == "id1"'

[[ "$(q "select count(*) from mam_message")" = 6 ]]
