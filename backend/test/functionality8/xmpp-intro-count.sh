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

../util/create-user.sh sender 0 0
../util/create-user.sh recipient1 0 0
../util/create-user.sh recipient2 0 0
../util/create-user.sh recipient3 0 0

assume_role sender ; sendertoken=$SESSION_TOKEN

senderuuid=$(get_uuid 'sender@example.com')
recipient1uuid=$(get_uuid 'recipient1@example.com')
recipient2uuid=$(get_uuid 'recipient2@example.com')
recipient3uuid=$(get_uuid 'recipient3@example.com')

chat_auth "$senderuuid" "$sendertoken"

sleep 1

curl -sX GET http://localhost:3001/pop > /dev/null

send_intro () {
  local toUuid=$1
  local id=$2
  local body=$3

  read -r -d '' payload <<EOF || true
{
  "message": {
    "@type": "chat",
    "@from": "${senderuuid}@duolicious.app",
    "@to": "${toUuid}@duolicious.app",
    "@id": "${id}",
    "@xmlns": "jabber:client",
    "body": "${body}",
    "request": {
      "@xmlns": "urn:xmpp:receipts"
    }
  }
}
EOF

  curl -sX POST http://localhost:3001/send -H "Content-Type: application/json" -d "$payload"
}

hash_used_count () {
  q "select coalesce(sum(used_count), 0) from intro_hash"
}



echo The first time an intro is used it is delivered and the count becomes 1

send_intro "$recipient1uuid" m1 "the very same intro"

sleep 3 # Allow the batched intro_hash upsert to flush and the cache to expire

expected=$(cat << EOF
{
  "duo_message_delivered": {
    "@id": "m1"
  }
}
EOF
)

diff -u --color --ignore-trailing-space \
  <(curl -sX GET http://localhost:3001/pop | jq -r 'del(.duo_message_delivered."@stamp", .duo_message_delivered."@mam_id")') \
  <(jq -r <<< "$expected")

[[ "$(hash_used_count)" = 1 ]]



echo Reusing the intro is rejected and reports it was already used once

send_intro "$recipient2uuid" m2 "the very same intro"

sleep 3

response=$(curl -sX GET http://localhost:3001/pop)

expected=$(cat << EOF
{
  "duo_message_not_unique": {
    "@id": "m2",
    "@used_count": "N"
  }
}
EOF
)

diff -u --color --ignore-trailing-space \
  <(jq '.duo_message_not_unique."@used_count" = "N"' <<< "$response") \
  <(jq -r <<< "$expected")

[[ $(jq -r '.duo_message_not_unique."@used_count"' <<< "$response") =~ ^[0-9]+$ ]]

[[ "$(hash_used_count)" = 2 ]]



echo Reusing the intro again reports the higher count and keeps incrementing

send_intro "$recipient3uuid" m3 "the very same intro"

sleep 3

response=$(curl -sX GET http://localhost:3001/pop)

expected=$(cat << EOF
{
  "duo_message_not_unique": {
    "@id": "m3",
    "@used_count": "N"
  }
}
EOF
)

diff -u --color --ignore-trailing-space \
  <(jq '.duo_message_not_unique."@used_count" = "N"' <<< "$response") \
  <(jq -r <<< "$expected")

[[ $(jq -r '.duo_message_not_unique."@used_count"' <<< "$response") =~ ^[0-9]+$ ]]

[[ "$(hash_used_count)" = 3 ]]



echo A distinct intro has its own independent count

send_intro "$recipient3uuid" m4 "a completely different intro"

sleep 3

expected=$(cat << EOF
{
  "duo_message_delivered": {
    "@id": "m4"
  }
}
EOF
)

diff -u --color --ignore-trailing-space \
  <(curl -sX GET http://localhost:3001/pop | jq -r 'del(.duo_message_delivered."@stamp", .duo_message_delivered."@mam_id")') \
  <(jq -r <<< "$expected")

[[ "$(q "select used_count from intro_hash order by last_used_at desc limit 1")" = 1 ]]
[[ "$(q "select count(*) from intro_hash")" = 2 ]]
