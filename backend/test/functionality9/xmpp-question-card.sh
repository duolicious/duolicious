#!/usr/bin/env bash

# Purpose: chat messages can reply to a quiz card via `@question_id`. The id
# is stored on both archive copies, the server serves the card (question text
# plus both participants' answers) on delivery and MAM fetches, the partner's
# answer is only ever served while it's public, and answer changes are pushed
# live as `duo_answer_update` to online-status subscribers -- but only when
# the publicly visible state changes, so private activity never leaks.

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

# Age the accounts so the intro spam heuristic treats them as trusted
q "update person set sign_up_time = now() - interval '7 days'"

assume_role user1 ; user1token=$SESSION_TOKEN
assume_role user2 ; user2token=$SESSION_TOKEN

user1uuid=$(get_uuid 'user1@example.com')
user2uuid=$(get_uuid 'user2@example.com')

user1id=$(get_id 'user1@example.com')
user2id=$(get_id 'user2@example.com')

question_id=10
question_text=$(q "select question from question where id = ${question_id}")
question_topic=$(q "select topic from question where id = ${question_id}")

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

# Like setup.sh's chat_auth, but on a named harness connection so both users
# can be online at once.
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
    -d '{ "server": "ws://api:5000/chat" }'

  sleep 0.2

  curl -sX POST "http://localhost:3001/send?id=${connectionId}" \
    -H "Content-Type: application/json" \
    -d "$authJson"

  sleep 1

  curl -sX GET "http://localhost:3001/pop?id=${connectionId}" > /dev/null
}

pop_connection () {
  local connectionId=$1
  curl -sX GET "http://localhost:3001/pop?id=${connectionId}"
}

# Send a chat message on a named connection, optionally with a @question_id.
send_message_as () {
  local connectionId=$1
  local fromUuid=$2
  local toUuid=$3
  local body=$4
  local questionId=${5:-}

  local questionAttr=""
  if [[ -n "$questionId" ]]
  then
    questionAttr="\"@question_id\": \"${questionId}\","
  fi

  read -r -d '' payload <<EOF || true
{
  "message": {
    "@type": "chat",
    "@from": "${fromUuid}@duolicious.app",
    "@to": "${toUuid}@duolicious.app",
    "@id": "id-$(next_query_id)",
    "@xmlns": "jabber:client",
    ${questionAttr}
    "body": "${body}",
    "request": {
      "@xmlns": "urn:xmpp:receipts"
    }
  }
}
EOF

  curl -sX POST "http://localhost:3001/send?id=${connectionId}" \
    -H "Content-Type: application/json" -d "$payload"
  sleep 2
}

# Fetch a single page of a conversation on a named connection and return the
# raw (newline-delimited JSON) response.
get_conversation_as () {
  local connectionId=$1
  local otherPersonUuid=$2
  local queryId=$(next_query_id)

  curl -sX GET "http://localhost:3001/pop?id=${connectionId}" > /dev/null
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

  curl -sX POST "http://localhost:3001/send?id=${connectionId}" \
    -H "Content-Type: application/json" -d "$query"
  sleep 0.5

  curl -sX GET "http://localhost:3001/pop?id=${connectionId}"
}

# Extract an attribute of the MAM message with the given body. Prints the
# empty string when the attribute is absent.
mam_attr_by_body () {
  local body=$1
  local attr=$2
  jq -rs '[ .[]
    | select(.message.result.forwarded.message.body == "'"$body"'")
    | .message.result.forwarded.message["'"$attr"'"]
  ] | .[0] // ""'
}

# Extract an attribute of a live-delivered message with the given body.
live_attr_by_body () {
  local body=$1
  local attr=$2
  jq -rs '[ .[]
    | select(.message.body == "'"$body"'")
    | .message["'"$attr"'"]
  ] | .[0] // ""'
}


echo "Setup: user2 answers publicly, user1 answers privately"

assume_role user2
jc POST /answer \
  -d "{ \"question_id\": ${question_id}, \"answer\": true, \"public\": true }"

assume_role user1
jc POST /answer \
  -d "{ \"question_id\": ${question_id}, \"answer\": false, \"public\": false }"

chat_auth_as user1 "$user1uuid" "$user1token"
chat_auth_as user2 "$user2uuid" "$user2token"


echo "A quiz-card reply is stored with its question_id on both archive copies"

body1="replying to your quiz card"
send_message_as user1 "$user1uuid" "$user2uuid" "$body1" "$question_id"

[[ "$(q "select question_id from mam_message where person_id = ${user1id}")" == "$question_id" ]] \
  || { echo "Expected question_id on the sender's copy"; exit 1; }
[[ "$(q "select question_id from mam_message where person_id = ${user2id}")" == "$question_id" ]] \
  || { echo "Expected question_id on the recipient's copy"; exit 1; }


echo "The recipient's live delivery carries the card, minus private answers"

user2_received=$(pop_connection user2)

[[ "$(live_attr_by_body "$body1" '@question_id' <<< "$user2_received")" == "$question_id" ]] \
  || { echo "Expected @question_id on the delivered message"; exit 1; }
[[ "$(live_attr_by_body "$body1" '@question' <<< "$user2_received")" == "$question_text" ]] \
  || { echo "Expected @question on the delivered message"; exit 1; }
[[ "$(live_attr_by_body "$body1" '@question_topic' <<< "$user2_received")" == "$question_topic" ]] \
  || { echo "Expected @question_topic on the delivered message"; exit 1; }
# The recipient's own answer, public or not, is theirs to see
[[ "$(live_attr_by_body "$body1" '@viewer_answer' <<< "$user2_received")" == "yes" ]] \
  || { echo "Expected the recipient's own answer on the delivered message"; exit 1; }
[[ "$(live_attr_by_body "$body1" '@viewer_answer_public' <<< "$user2_received")" == "true" ]] \
  || { echo "Expected the recipient's answer to be flagged public"; exit 1; }
# The sender answered privately, so their answer must be absent
[[ "$(live_attr_by_body "$body1" '@partner_answer' <<< "$user2_received")" == "" ]] \
  || { echo "Expected the sender's private answer to be hidden"; exit 1; }


echo "MAM serves the card with the partner's answer filtered by publicness"

user1_convo=$(get_conversation_as user1 "$user2uuid")

[[ "$(mam_attr_by_body "$body1" '@question_id' <<< "$user1_convo")" == "$question_id" ]] \
  || { echo "Expected @question_id in user1's MAM result"; exit 1; }
[[ "$(mam_attr_by_body "$body1" '@question' <<< "$user1_convo")" == "$question_text" ]] \
  || { echo "Expected @question in user1's MAM result"; exit 1; }
# user1's own private answer is served to them, flagged private
[[ "$(mam_attr_by_body "$body1" '@viewer_answer' <<< "$user1_convo")" == "no" ]] \
  || { echo "Expected user1's own answer in their MAM result"; exit 1; }
[[ "$(mam_attr_by_body "$body1" '@viewer_answer_public' <<< "$user1_convo")" == "false" ]] \
  || { echo "Expected user1's answer to be flagged private"; exit 1; }
# user2's answer is public, so user1 sees it
[[ "$(mam_attr_by_body "$body1" '@partner_answer' <<< "$user1_convo")" == "yes" ]] \
  || { echo "Expected user2's public answer in user1's MAM result"; exit 1; }


echo "Making an answer private removes it from the partner's MAM results"

assume_role user2
jc POST /answer \
  -d "{ \"question_id\": ${question_id}, \"answer\": true, \"public\": false }"

user1_convo=$(get_conversation_as user1 "$user2uuid")
[[ "$(mam_attr_by_body "$body1" '@partner_answer' <<< "$user1_convo")" == "" ]] \
  || { echo "Expected user2's now-private answer to be hidden from user1"; exit 1; }

# user2 still sees their own answer, now flagged private
user2_convo=$(get_conversation_as user2 "$user1uuid")
[[ "$(mam_attr_by_body "$body1" '@viewer_answer' <<< "$user2_convo")" == "yes" ]] \
  || { echo "Expected user2 to still see their own answer"; exit 1; }
[[ "$(mam_attr_by_body "$body1" '@viewer_answer_public' <<< "$user2_convo")" == "false" ]] \
  || { echo "Expected user2's answer to be flagged private"; exit 1; }


echo "Answer changes are pushed live to online-status subscribers"

curl -sX GET "http://localhost:3001/pop?id=user1" > /dev/null
curl -sX POST "http://localhost:3001/send?id=user1" \
  -H "Content-Type: application/json" \
  -d "{ \"duo_subscribe_online\": { \"@uuid\": \"${user2uuid}\" } }"
sleep 1
curl -sX GET "http://localhost:3001/pop?id=user1" > /dev/null

# private -> public: pushed with the answer
assume_role user2
jc POST /answer \
  -d "{ \"question_id\": ${question_id}, \"answer\": true, \"public\": true }"
sleep 1

update=$(pop_connection user1)
[[ "$(jq -rs '[ .[] | .duo_answer_update["@answer"] // empty ] | .[0]' <<< "$update")" == "yes" ]] \
  || { echo "Expected a duo_answer_update with the new public answer, got: $update"; exit 1; }
[[ "$(jq -rs '[ .[] | .duo_answer_update["@uuid"] // empty ] | .[0]' <<< "$update")" == "$user2uuid" ]] \
  || { echo "Expected the update to name user2"; exit 1; }
[[ "$(jq -rs '[ .[] | .duo_answer_update["@question_id"] // empty ] | .[0]' <<< "$update")" == "$question_id" ]] \
  || { echo "Expected the update to name the question"; exit 1; }

# public -> private: pushed as hidden (no @answer)
jc POST /answer \
  -d "{ \"question_id\": ${question_id}, \"answer\": true, \"public\": false }"
sleep 1

update=$(pop_connection user1)
[[ "$(jq -rs '[ .[] | select(.duo_answer_update) ] | length' <<< "$update")" == "1" ]] \
  || { echo "Expected exactly one duo_answer_update, got: $update"; exit 1; }
[[ "$(jq -rs '[ .[] | select(.duo_answer_update) | .duo_answer_update | has("@answer") ] | .[0]' <<< "$update")" == "false" ]] \
  || { echo "Expected the update to carry no answer, got: $update"; exit 1; }

# private -> private: never pushed, so private activity can't leak
jc POST /answer \
  -d "{ \"question_id\": ${question_id}, \"answer\": false, \"public\": false }"
sleep 1

update=$(pop_connection user1)
[[ "$(jq -rs '[ .[] | select(.duo_answer_update) ] | length' <<< "$update")" == "0" ]] \
  || { echo "Expected no duo_answer_update for a private edit, got: $update"; exit 1; }

# deleting an already-hidden answer: nothing visible changed, so no event
jc DELETE /answer -d "{ \"question_id\": ${question_id} }"
sleep 1

update=$(pop_connection user1)
[[ "$(jq -rs '[ .[] | select(.duo_answer_update) ] | length' <<< "$update")" == "0" ]] \
  || { echo "Expected no duo_answer_update for a hidden delete, got: $update"; exit 1; }


echo "An invalid question_id degrades to a plain text message"

q "delete from mam_message"
q "delete from intro_hash"

body2="a reply with a nonexistent question"
send_message_as user1 "$user1uuid" "$user2uuid" "$body2" "32000"

body3="a reply with a zero question"
send_message_as user1 "$user1uuid" "$user2uuid" "$body3" "0"

body4="a reply with a junk question"
send_message_as user1 "$user1uuid" "$user2uuid" "$body4" "junk"

[[ "$(q "select count(*) from mam_message where question_id is not null")" -eq 0 ]] \
  || { echo "Expected no question_id to be stored for invalid references"; exit 1; }
[[ "$(q "select count(*) from mam_message")" -eq 6 ]] \
  || { echo "Expected the messages to be delivered as plain text"; exit 1; }

user2_received=$(pop_connection user2)
[[ "$(live_attr_by_body "$body2" '@question_id' <<< "$user2_received")" == "" ]] \
  || { echo "Expected no card attributes on an invalid reference"; exit 1; }
