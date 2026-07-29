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

query_id () {
  local _query_id=$(cat /tmp/duo_query_id 2> /dev/null)

  if [[ -z "$_query_id" ]]
  then
    echo 0
  else
    echo "$_query_id"
  fi
}

next_query_id () {
  local _next_query_id=$(( "$(query_id)" + 1 ))

  printf "%s" "$_next_query_id" > /tmp/duo_query_id
  printf "%s" "$_next_query_id"
}

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
  sleep 1
}

mark_displayed () {
  local fromUuid=$1
  local fromToken=$2
  local toUuid=$3
  local queryId=$(next_query_id)

  chat_auth "$fromUuid" "$fromToken"

  sleep 1

  read -r -d '' query <<EOF || true
{
  "message": {
    "@to": "${toUuid}@duolicious.app",
    "@from": "${fromUuid}@duolicious.app",
    "displayed": {
      "@xmlns": "urn:xmpp:chat-markers:0",
      "@id": "${queryId}"
    }
  }
}
EOF

  curl -X POST http://localhost:3001/send -H "Content-Type: application/json" -d "$query"
  sleep 1
}

# Fetches a single page of a conversation and returns the raw (newline-delimited
# JSON) response, so callers can assert on any stanza, including read receipts.
get_conversation () {
  local userUuid=$1
  local userToken=$2
  local otherPersonUuid=$3
  local queryId=$(next_query_id)

  chat_auth "$userUuid" "$userToken"
  sleep 1
  curl -sX GET http://localhost:3001/pop > /dev/null
  sleep 0.5

  read -r -d '' query <<EOF || true
{
  "iq": {
    "@type": "set",
    "@id": "${queryId}",
    "query": {
      "@xmlns": "urn:xmpp:mam:2",
      "@queryid": "${queryId}",
      "x": {
        "@xmlns": "jabber:x:data",
        "@type": "submit",
        "field": [
          { "@var": "FORM_TYPE", "value": "urn:xmpp:mam:2" },
          { "@var": "with", "value": "${otherPersonUuid}@duolicious.app" }
        ]
      },
      "set": {
        "@xmlns": "http://jabber/protocol/rsm",
        "max": "50",
        "before": ""
      }
    }
  }
}
EOF

  curl -X POST http://localhost:3001/send -H "Content-Type: application/json" -d "$query"
  sleep 0.5

  curl -sX GET http://localhost:3001/pop
}

# Counts read-receipt stanzas in a conversation response, optionally filtering by
# the sender (reader) and recipient (viewer) JIDs.
count_read_receipts () {
  local fromUuid=$1
  local toUuid=$2

  jq -s '[ .[]
    | select(.message["@type"] == "read-receipt")
    | select(.message["@from"] == "'"${fromUuid}"'@duolicious.app")
    | select(.message["@to"] == "'"${toUuid}"'@duolicious.app")
    | select(.message.displayed["@stamp"] != null)
  ] | length'
}


echo "A gold user sees a read receipt once the recipient reads their message"

q "update person set has_gold = true where uuid = '${user1uuid}'"

send_message "$user1uuid" "$user1token" "$user2uuid" "hello from user 1"

mark_displayed "$user2uuid" "$user2token" "$user1uuid"

# The reader's inbox row records when it was last displayed.
displayed_at=$(q "
  select displayed_at
  from inbox
  where luser = '${user2uuid}' and remote_bare_jid = '${user1uuid}@duolicious.app'
")
[[ -n "$displayed_at" ]] || { echo "Expected inbox.displayed_at to be set, got '$displayed_at'"; exit 1; }

gold_conversation=$(get_conversation "$user1uuid" "$user1token" "$user2uuid")

gold_receipts=$(count_read_receipts "$user2uuid" "$user1uuid" <<< "$gold_conversation")
[[ "$gold_receipts" == "1" ]] \
  || { echo "Expected 1 read receipt for the gold user, got ${gold_receipts}"; exit 1; }

message_stamp=$(jq -s -r '
  [.[] | .message.result.forwarded.delay["@stamp"]? | select(. != null)] | max
' <<< "$gold_conversation")

receipt_stamp=$(jq -s -r '
  [ .[]
    | select(.message["@type"] == "read-receipt")
    | .message.displayed["@stamp"]
    | select(. != null)
  ][0]
' <<< "$gold_conversation")

[[ -n "$message_stamp" && "$message_stamp" != "null" ]] \
  || { echo "Missing message stamp"; exit 1; }
[[ "$receipt_stamp" == "$message_stamp" || "$receipt_stamp" > "$message_stamp" ]] \
  || { echo "Receipt stamp '${receipt_stamp}' predates message stamp '${message_stamp}'"; exit 1; }


echo "Re-reading the same last message does not advance the read receipt"

first_displayed_at="$displayed_at"

mark_displayed "$user2uuid" "$user2token" "$user1uuid"
sleep 2

displayed_at_after_reopen=$(q "
  select displayed_at
  from inbox
  where luser = '${user2uuid}' and remote_bare_jid = '${user1uuid}@duolicious.app'
")
[[ "$displayed_at_after_reopen" == "$first_displayed_at" ]] \
  || { echo "Expected displayed_at to be unchanged on re-read, was '${first_displayed_at}', now '${displayed_at_after_reopen}'"; exit 1; }


echo "Reading a newer message advances the read receipt"

send_message "$user1uuid" "$user1token" "$user2uuid" "another message from user 1"

mark_displayed "$user2uuid" "$user2token" "$user1uuid"
sleep 2

displayed_at_after_new=$(q "
  select displayed_at
  from inbox
  where luser = '${user2uuid}' and remote_bare_jid = '${user1uuid}@duolicious.app'
")
[[ "$displayed_at_after_new" > "$first_displayed_at" ]] \
  || { echo "Expected displayed_at to advance after reading a new message, was '${first_displayed_at}', now '${displayed_at_after_new}'"; exit 1; }


echo "A non-gold user sees no read receipts"

# create-user.sh makes every user gold, so user3's gold is revoked here. A
# separate user (rather than revoking user1) is used because `fetch_has_gold`
# is cached for 60s: user3's gold status is only ever read after this point,
# so the cache never holds a stale `true` for them.
q "update person set has_gold = false where uuid = '${user3uuid}'"

send_message "$user3uuid" "$user3token" "$user2uuid" "hello from user 3"

mark_displayed "$user2uuid" "$user2token" "$user3uuid"

# The read is recorded regardless of gold; only its visibility is gated.
displayed_at=$(q "
  select displayed_at
  from inbox
  where luser = '${user2uuid}' and remote_bare_jid = '${user3uuid}@duolicious.app'
")
[[ -n "$displayed_at" ]] || { echo "Expected inbox.displayed_at to be set, got '$displayed_at'"; exit 1; }

basic_conversation=$(get_conversation "$user3uuid" "$user3token" "$user2uuid")

basic_receipts=$(count_read_receipts "$user2uuid" "$user3uuid" <<< "$basic_conversation")
[[ "$basic_receipts" == "0" ]] \
  || { echo "Expected 0 read receipts for the non-gold user, got ${basic_receipts}"; exit 1; }
