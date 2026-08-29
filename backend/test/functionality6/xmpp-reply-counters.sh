#!/usr/bin/env bash

# Purpose: `person`'s four reply-rate counters are maintained by the chat path,
# which classifies each new `messaged` row as an intro or a reply. The profile's
# "Gets Replies To" and "Gives Replies To" percentages read them, so this drives
# real messages and checks each counter lands on the right person.

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

user1uuid=$(get_uuid 'user1@example.com')
user2uuid=$(get_uuid 'user2@example.com')
user3uuid=$(get_uuid 'user3@example.com')

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
  sleep 2
}

# The four counters in one string, so a single assertion pins every one of them
# and an unintended bump can't hide behind an unchecked column. In order:
# intros received, of those the ones replied to, intros sent, and of those the
# ones that got a reply.
counters () {
  q "
  select
    count_intros_received            || ' ' ||
    count_intros_received_with_reply || ' ' ||
    count_intros_sent                || ' ' ||
    count_intros_sent_with_reply
  from person where name = '$1'
  "
}



echo Everyone starts at zero

[[ "$(counters user1)" = '0 0 0 0' ]]
[[ "$(counters user2)" = '0 0 0 0' ]]
[[ "$(counters user3)" = '0 0 0 0' ]]



echo An intro counts as sent for the sender and received for the recipient

send_message "$user1uuid" "$user1token" "$user2uuid" "hello there user2"

[[ "$(counters user1)" = '0 0 1 0' ]]
[[ "$(counters user2)" = '1 0 0 0' ]]



echo A reply counts for the replier and credits the intro that earned it

send_message "$user2uuid" "$user2token" "$user1uuid" "hello back user1"

[[ "$(counters user1)" = '0 0 1 1' ]]
[[ "$(counters user2)" = '1 1 0 0' ]]



echo Further messages in an existing conversation move nothing

send_message "$user1uuid" "$user1token" "$user2uuid" "still here user2"
send_message "$user2uuid" "$user2token" "$user1uuid" "still here user1"

[[ "$(counters user1)" = '0 0 1 1' ]]
[[ "$(counters user2)" = '1 1 0 0' ]]



echo A second intro from the same sender counts again

send_message "$user1uuid" "$user1token" "$user3uuid" "hello there user3"

[[ "$(counters user1)" = '0 0 2 1' ]]
[[ "$(counters user3)" = '1 0 0 0' ]]
