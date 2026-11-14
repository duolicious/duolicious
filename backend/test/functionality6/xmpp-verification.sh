#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

snd1=$(rand_sound)

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
../util/create-user.sh user4 0 0

q "update person set required_verification_level_id = 2 where name IN ('user1', 'user2')"
q "update person set verification_level_id = 2 where name = 'user2'"

assume_role user1 ; user1token=$SESSION_TOKEN
assume_role user2 ; user2token=$SESSION_TOKEN
assume_role user3 ; user3token=$SESSION_TOKEN
assume_role user4 ; user4token=$SESSION_TOKEN

user1uuid=$(get_uuid 'user1@example.com')
user2uuid=$(get_uuid 'user2@example.com')
user3uuid=$(get_uuid 'user3@example.com')
user4uuid=$(get_uuid 'user4@example.com')



echo "user 1 requires verification but they're not verified"

chat_auth "$user1uuid" "$user1token"

sleep 1

curl -sX GET http://localhost:3001/pop > /dev/null

read -r -d '' payload <<EOF || true
{
  "message": {
    "@type": "chat",
    "@from": "${user1uuid}@duolicious.app",
    "@to": "${user4uuid}@duolicious.app",
    "@id": "id1",
    "@xmlns": "jabber:client",
    "body": "this message should require verification",
    "request": {
      "@xmlns": "urn:xmpp:receipts"
    }
  }
}
EOF

curl -sX POST http://localhost:3001/send -H "Content-Type: application/json" -d "$payload"

sleep 1

expected=$(cat << EOF
{
  "duo_message_blocked": {
    "@id": "id1",
    "@reason": "age-verification"
  }
}
EOF
)

diff -u --color --ignore-trailing-space \
  <(curl -sX GET http://localhost:3001/pop | jq -r 'del(.duo_message_delivered."@stamp", .duo_message_delivered."@mam_id")') \
  <(jq -r <<< "$expected")





echo "user 2 requires verification but and they're verified"

chat_auth "$user2uuid" "$user2token"

sleep 1

curl -sX GET http://localhost:3001/pop > /dev/null

read -r -d '' payload <<EOF || true
{
  "message": {
    "@type": "chat",
    "@from": "${user2uuid}@duolicious.app",
    "@to": "${user4uuid}@duolicious.app",
    "@id": "id2",
    "@xmlns": "jabber:client",
    "body": "this message should require verification but be sent",
    "request": {
      "@xmlns": "urn:xmpp:receipts"
    }
  }
}
EOF

curl -sX POST http://localhost:3001/send -H "Content-Type: application/json" -d "$payload"

sleep 1

expected=$(cat << EOF
{
  "duo_message_delivered": {
    "@id": "id2"
  }
}
EOF
)

diff -u --color --ignore-trailing-space \
  <(curl -sX GET http://localhost:3001/pop | jq -r 'del(.duo_message_delivered."@stamp", .duo_message_delivered."@mam_id")') \
  <(jq -r <<< "$expected")





echo "user 3 doesn't require verification"

chat_auth "$user3uuid" "$user3token"

sleep 1

curl -sX GET http://localhost:3001/pop > /dev/null

read -r -d '' payload <<EOF || true
{
  "message": {
    "@type": "chat",
    "@from": "${user3uuid}@duolicious.app",
    "@to": "${user4uuid}@duolicious.app",
    "@id": "id3",
    "@xmlns": "jabber:client",
    "body": "this message should be sent because verification isn't required",
    "request": {
      "@xmlns": "urn:xmpp:receipts"
    }
  }
}
EOF

curl -sX POST http://localhost:3001/send -H "Content-Type: application/json" -d "$payload"

sleep 1

expected=$(cat << EOF
{
  "duo_message_delivered": {
    "@id": "id3"
  }
}
EOF
)

diff -u --color --ignore-trailing-space \
  <(curl -sX GET http://localhost:3001/pop | jq -r 'del(.duo_message_delivered."@stamp", .duo_message_delivered."@mam_id")') \
  <(jq -r <<< "$expected")





echo "user 2 requires photo verification but only has basics verified"

q "update person set required_verification_level_id = 3 where name = 'user2'"
sleep 4

chat_auth "$user2uuid" "$user2token"

sleep 1

curl -sX GET http://localhost:3001/pop > /dev/null

read -r -d '' payload <<EOF || true
{
  "message": {
    "@type": "chat",
    "@from": "${user2uuid}@duolicious.app",
    "@to": "${user4uuid}@duolicious.app",
    "@id": "id4",
    "@xmlns": "jabber:client",
    "body": "this message should require photo verification",
    "request": {
      "@xmlns": "urn:xmpp:receipts"
    }
  }
}
EOF

curl -sX POST http://localhost:3001/send -H "Content-Type: application/json" -d "$payload"

sleep 1

expected=$(cat << EOF
{
  "duo_message_blocked": {
    "@id": "id4",
    "@reason": "age-verification",
    "@subreason": "unverified-photos"
  }
}
EOF
)

diff -u --color --ignore-trailing-space \
  <(curl -sX GET http://localhost:3001/pop | jq -r 'del(.duo_message_delivered."@stamp", .duo_message_delivered."@mam_id")') \
  <(jq -r <<< "$expected")
