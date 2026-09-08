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
../util/create-user.sh user2 0 0
../util/create-user.sh user3 0 0

# Age the accounts so the intro spam heuristic treats them as trusted
q "update person set sign_up_time = now() - interval '7 days'"

assume_role user1 ; user1token=$SESSION_TOKEN
assume_role user2 ; user2token=$SESSION_TOKEN
assume_role user3 ; user3token=$SESSION_TOKEN

user1uuid=$(get_uuid 'user1@example.com')
user2uuid=$(get_uuid 'user2@example.com')
user3uuid=$(get_uuid 'user3@example.com')

user1id=$(get_id 'user1@example.com')
user2id=$(get_id 'user2@example.com')
user3id=$(get_id 'user3@example.com')

emoji1='👍'
emoji2='😂'

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
  sleep 2
}

# Authenticate as the reactor, send a duo_reaction stanza for `mamId`, and return
# whatever the reactor's own connection received back (the ack or rejection).
send_reaction () {
  local fromUuid=$1
  local fromToken=$2
  local toUuid=$3
  local mamId=$4
  local emoji=$5

  chat_auth "$fromUuid" "$fromToken"
  sleep 1

  read -r -d '' payload <<EOF || true
{
  "duo_reaction": {
    "@to": "${toUuid}@duolicious.app",
    "@id": "r1",
    "@mam_id": "${mamId}",
    "@emoji": "${emoji}"
  }
}
EOF

  curl -sX GET http://localhost:3001/pop > /dev/null
  curl -sX POST http://localhost:3001/send \
    -H "Content-Type: application/json" -d "$payload" > /dev/null
  sleep 2

  curl -sX GET http://localhost:3001/pop
}

# Fetches a single page of a conversation and returns the raw (newline-delimited
# JSON) response.
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

# Extract the MAM result id (mamId) of the message with the given body, from a
# conversation response on stdin.
mam_id_by_body () {
  local body=$1
  jq -rs '[ .[]
    | select(.message.result.forwarded.message.body == "'"$body"'")
    | .message.result["@id"]
  ] | .[0]'
}

# Extract the reaction attribute of the message with the given body. Prints the
# empty string when there is no reaction.
reaction_by_body () {
  local body=$1
  jq -rs '[ .[]
    | select(.message.result.forwarded.message.body == "'"$body"'")
    | .message.result.forwarded.message["@reaction"]
  ] | .[0] // ""'
}

# Extract the reaction_from attribute of the message with the given body.
reaction_from_by_body () {
  local body=$1
  jq -rs '[ .[]
    | select(.message.result.forwarded.message.body == "'"$body"'")
    | .message.result.forwarded.message["@reaction_from"]
  ] | .[0] // ""'
}

# Count message results carrying the given body (reactions must be inline, never
# separate stanzas).
count_message_results () {
  local body=$1
  jq -rs '[ .[]
    | select(.message.result.forwarded.message.body == "'"$body"'")
  ] | length'
}


echo "A user can react to the other person's message"

body1="hello from user 1"
send_message "$user1uuid" "$user1token" "$user2uuid" "$body1"

# user2 (the recipient) looks up the message's mam_id from their own archive.
user2_convo=$(get_conversation "$user2uuid" "$user2token" "$user1uuid")
mam_id=$(mam_id_by_body "$body1" <<< "$user2_convo")
[[ -n "$mam_id" && "$mam_id" != "null" ]] \
  || { echo "Expected to find a mam_id for the message, got '$mam_id'"; exit 1; }

ack=$(send_reaction "$user2uuid" "$user2token" "$user1uuid" "$mam_id" "$emoji1")
echo "$ack" | grep -q duo_reaction_delivered \
  || { echo "Expected the reactor to get a duo_reaction_delivered ack, got: $ack"; exit 1; }

# The reaction is stored on BOTH archive copies.
[[ "$(q "select count(*) from mam_message where person_id = ${user1id} and reaction = '${emoji1}'")" -eq 1 ]] \
  || { echo "Expected the reaction on the sender's copy"; exit 1; }
[[ "$(q "select count(*) from mam_message where person_id = ${user2id} and reaction = '${emoji1}'")" -eq 1 ]] \
  || { echo "Expected the reaction on the recipient's copy"; exit 1; }


echo "MAM replays the reaction inline, with reactor derived from direction"

# The reactor (user2) sees their own reaction as 'self'.
user2_convo=$(get_conversation "$user2uuid" "$user2token" "$user1uuid")
[[ "$(reaction_by_body "$body1" <<< "$user2_convo")" == "$emoji1" ]] \
  || { echo "Expected user2 to see the reaction in MAM"; exit 1; }
[[ "$(reaction_from_by_body "$body1" <<< "$user2_convo")" == "self" ]] \
  || { echo "Expected reaction_from=self for the reactor"; exit 1; }

# The partner (user1) sees the same reaction as 'other'.
user1_convo=$(get_conversation "$user1uuid" "$user1token" "$user2uuid")
[[ "$(reaction_by_body "$body1" <<< "$user1_convo")" == "$emoji1" ]] \
  || { echo "Expected user1 to see the reaction in MAM"; exit 1; }
[[ "$(reaction_from_by_body "$body1" <<< "$user1_convo")" == "other" ]] \
  || { echo "Expected reaction_from=other for the partner"; exit 1; }

# Old-client safety: the reaction rides along on the existing message (no extra
# stanza), so a client ignoring the attributes still sees exactly one message.
[[ "$(count_message_results "$body1" <<< "$user1_convo")" -eq 1 ]] \
  || { echo "Expected exactly one message result (reaction must be inline)"; exit 1; }


echo "Re-reacting with a different emoji replaces the reaction"

send_reaction "$user2uuid" "$user2token" "$user1uuid" "$mam_id" "$emoji2" > /dev/null
[[ "$(q "select count(*) from mam_message where reaction = '${emoji2}'")" -eq 2 ]] \
  || { echo "Expected both copies to hold the replacement emoji"; exit 1; }
[[ "$(q "select count(*) from mam_message where reaction = '${emoji1}'")" -eq 0 ]] \
  || { echo "Expected the old emoji to be gone"; exit 1; }


echo "Reacting with an empty emoji clears the reaction"

send_reaction "$user2uuid" "$user2token" "$user1uuid" "$mam_id" "" > /dev/null
[[ "$(q "select count(*) from mam_message where reaction is not null")" -eq 0 ]] \
  || { echo "Expected the reaction to be cleared on both copies"; exit 1; }


echo "A user cannot react to their own message"

# user1 looks up THEIR copy of the message they sent, then tries to react to it.
user1_convo=$(get_conversation "$user1uuid" "$user1token" "$user2uuid")
own_mam_id=$(mam_id_by_body "$body1" <<< "$user1_convo")

rejection=$(send_reaction "$user1uuid" "$user1token" "$user2uuid" "$own_mam_id" "$emoji1")
echo "$rejection" | grep -q duo_reaction_blocked \
  || { echo "Expected reacting to one's own message to be blocked, got: $rejection"; exit 1; }
[[ "$(q "select count(*) from mam_message where reaction is not null")" -eq 0 ]] \
  || { echo "Expected no reaction to be stored for a self-reaction"; exit 1; }


echo "A user who requires verification cannot react"

body2="hello from user 1 to unverified user 3"
send_message "$user1uuid" "$user1token" "$user3uuid" "$body2"

q "update person set verification_required = true where id = ${user3id}"
sleep 4 # let the 3s verification-required cache expire

user3_convo=$(get_conversation "$user3uuid" "$user3token" "$user1uuid")
mam_id_2=$(mam_id_by_body "$body2" <<< "$user3_convo")

rejection=$(send_reaction "$user3uuid" "$user3token" "$user1uuid" "$mam_id_2" "$emoji1")
echo "$rejection" | grep -q duo_reaction_blocked \
  || { echo "Expected verification-required reaction to be blocked, got: $rejection"; exit 1; }
[[ "$(q "select count(*) from mam_message where reaction is not null")" -eq 0 ]] \
  || { echo "Expected no reaction to be stored for a verification-required reaction"; exit 1; }

q "update person set verification_required = false where id = ${user3id}"
sleep 4 # let the 3s verification-required cache expire


echo "A shadow-banned reactor's reaction is stored only on their own side"

body3="hello from user 1 to user 3"
send_message "$user1uuid" "$user1token" "$user3uuid" "$body3"

q "update person set shadow_banned_at = now() where id = ${user3id}"
sleep 6 # let the 5s shadow-ban cache expire

user3_convo=$(get_conversation "$user3uuid" "$user3token" "$user1uuid")
mam_id_3=$(mam_id_by_body "$body3" <<< "$user3_convo")

ack=$(send_reaction "$user3uuid" "$user3token" "$user1uuid" "$mam_id_3" "$emoji1")
# The reactor still gets a delivery ack so their app behaves normally.
echo "$ack" | grep -q duo_reaction_delivered \
  || { echo "Expected the shadow-banned reactor to get an ack, got: $ack"; exit 1; }

# Their own copy holds the reaction...
[[ "$(q "select count(*) from mam_message where person_id = ${user3id} and reaction = '${emoji1}'")" -eq 1 ]] \
  || { echo "Expected the shadow-banned reactor's own copy to hold the reaction"; exit 1; }
# ...but the partner's copy is untouched.
[[ "$(q "select count(*) from mam_message where person_id = ${user1id} and reaction is not null")" -eq 0 ]] \
  || { echo "Expected the partner's copy to stay unreacted"; exit 1; }
