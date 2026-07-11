#!/usr/bin/env bash

# Purpose: A new, visible reaction surfaces in both people's inboxes and sends
# the partner a push notification (issue #1177). Verify that:
#   1. Reacting upserts both people's inbox rows, inserts `messaged`, pushes a
#      live `duo_inbox_entry` to both people (before the `duo_reaction` on the
#      partner's side), and sends a push whose title names the reactor and
#      emoji.
#   2. Re-sending the same emoji is a no-op; changing the emoji re-notifies;
#      clearing is quiet but still refreshes both inboxes.
#   3. A shadow-banned reactor only updates their own side and sends nothing.

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
q "delete from messaged"
q "delete from intro_hash"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0
../util/create-user.sh user3 0 0

# Age the accounts so the intro spam heuristic treats them as trusted
q "update person set sign_up_time = now() - interval '7 days'"

# Everyone wants immediate notifications and has never been notified
q "update person
   set intros_notification = 1, chats_notification = 1,
       intro_seconds = 0, chat_seconds = 0"

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

send_message_as () {
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

send_reaction_as () {
  local connectionId=$1
  local toUuid=$2
  local mamId=$3
  local emoji=$4

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

  curl -sX GET "http://localhost:3001/pop?id=${connectionId}" > /dev/null
  curl -sX POST "http://localhost:3001/send?id=${connectionId}" \
    -H "Content-Type: application/json" -d "$payload" > /dev/null
  sleep 2
}

register_push_token_as () {
  local connectionId=$1
  local token=$2

  read -r -d '' payload <<EOF || true
{ "duo_register_push_token": { "@token": "${token}" } }
EOF

  curl -X POST "http://localhost:3001/send?id=${connectionId}" \
    -H "Content-Type: application/json" -d "$payload"
  sleep 1.5
}

# Fetches a single page of a conversation on the given connection and returns
# the raw (newline-delimited JSON) response.
get_conversation_as () {
  local connectionId=$1
  local otherPersonUuid=$2

  curl -sX GET "http://localhost:3001/pop?id=${connectionId}" > /dev/null
  sleep 0.5

  read -r -d '' query <<EOF || true
{
  "iq": {
    "@type": "set",
    "@id": "q1",
    "query": {
      "@xmlns": "urn:xmpp:mam:2",
      "@queryid": "q1",
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

  curl -X POST "http://localhost:3001/send?id=${connectionId}" \
    -H "Content-Type: application/json" -d "$query"
  sleep 0.5

  curl -sX GET "http://localhost:3001/pop?id=${connectionId}"
}

query_inbox_snapshot_as () {
  local connectionId=$1

  curl -sX GET "http://localhost:3001/pop?id=${connectionId}" > /dev/null
  sleep 0.5

  curl -X POST "http://localhost:3001/send?id=${connectionId}" \
    -H "Content-Type: application/json" \
    -d '{ "duo_query_inbox": null }'

  sleep 1

  curl -sX GET "http://localhost:3001/pop?id=${connectionId}"
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

# The inbox row a reaction should touch, as "body|reaction|unread_count".
# `body` must always stay the conversation's last message; a live reaction
# rides in its own column.
inbox_row () {
  local luser=$1
  local remote=$2

  q "select body || '|' || coalesce(reaction, '') || '|' || unread_count
     from inbox
     where luser = '${luser}'
     and remote_bare_jid = '${remote}@duolicious.app'"
}

titles_of_pushes_to () {
  local token=$1
  curl -s 'http://localhost:3002/messages' \
    | jq -c "[.[] | select(.to == \"${token}\") | .title]"
}

chat_auth_as user1 "$user1uuid" "$user1token"
chat_auth_as user2 "$user2uuid" "$user2token"

# user2 registers a push token over their chat connection, then we make that
# session the most recent so the live push targets it.
register_push_token_as user2 'user2-token'
q "update duo_session set last_online_time = now() where push_token = 'user2-token'"

clear_pushes


echo "A reaction to an un-replied intro reaches the partner's inbox and phone"

body1="intro from user 2"
send_message_as user2 "$user2uuid" "$user1uuid" "$body1"

# user1 (the recipient) looks up the message's mam_id from their own archive,
# then reacts to it without ever replying.
mam_id=$(get_conversation_as user1 "$user2uuid" | mam_id_by_body "$body1")
[[ -n "$mam_id" && "$mam_id" != "null" ]]

curl -sX GET "http://localhost:3001/pop?id=user2" > /dev/null

send_reaction_as user1 "$user2uuid" "$mam_id" "$emoji1"

# The partner's inbox row keeps the message as `body` and holds the reaction
# in its own column, unread, in chats
[[ "$(inbox_row "$user2uuid" "$user1uuid")" == "${body1}|${emoji1}|1" ]]
[[ "$(q "select box from inbox
         where luser = '${user2uuid}'
         and remote_bare_jid = '${user1uuid}@duolicious.app'")" == "chats" ]]

# The reactor's own row is updated too, read
[[ "$(inbox_row "$user1uuid" "$user2uuid")" == "${body1}|${emoji1}|0" ]]

# Reacting counts as engagement
[[ "$(q "select count(*) from messaged
         where subject_person_id = ${user1id}
         and object_person_id = ${user2id}")" -eq 1 ]]

# The partner's open connection got the inbox entry before the reaction
received=$(curl -sX GET "http://localhost:3001/pop?id=user2")
[[ "$(jq -s -r '[.[] | keys[0]] | join(",")' <<< "$received")" \
    == "duo_inbox_entry,duo_reaction" ]]

entry=$(jq -s '[.[] | .duo_inbox_entry | select(. != null)][0]' <<< "$received")
[[ "$(jq -r '.location' <<< "$entry")" == "chats" ]]
[[ "$(jq -r '.last_message' <<< "$entry")" == "Reacted ${emoji1} to: ${body1}" ]]
[[ "$(jq -r '.last_message_read' <<< "$entry")" == "false" ]]

# The reactor's own open client gets its updated inbox entry too, already
# read, so backing out of the conversation shows the new preview
received1=$(curl -sX GET "http://localhost:3001/pop?id=user1")
entry1=$(jq -s '[.[] | .duo_inbox_entry | select(. != null)][0]' <<< "$received1")
[[ "$(jq -r '.last_message' <<< "$entry1")" == "Reacted ${emoji1} to: ${body1}" ]]
[[ "$(jq -r '.last_message_read' <<< "$entry1")" == "true" ]]

# The push landed, with a reaction-specific title, deep-linking to the convo
[[ "$(count_pushes_to 'user2-token')" -eq 1 ]]
[[ "$(titles_of_pushes_to 'user2-token')" == "[\"user1 reacted ${emoji1} to your message\"]" ]]
[[ "$(curl -s 'http://localhost:3002/messages' \
    | jq -r '.[0].data.screen')" == "Conversation Screen" ]]

# The last-notification marker advanced, so the cron won't double-notify
[[ "$(q "select count(*) from person
         where id = ${user2id} and chat_seconds > 0")" -eq 1 ]]

# The partner's inbox snapshot agrees with the live entry
snapshot=$(query_inbox_snapshot_as user2)
[[ "$(jq -s -r '[.[] | .duo_inbox | select(. != null)][0]
    | .conversations[0]
    | "\(.location)|\(.last_message)|\(.last_message_read)"' <<< "$snapshot")" \
    == "chats|Reacted ${emoji1} to: ${body1}|false" ]]


echo "Re-sending the same emoji changes nothing"

send_reaction_as user1 "$user2uuid" "$mam_id" "$emoji1"

[[ "$(inbox_row "$user2uuid" "$user1uuid")" == "${body1}|${emoji1}|1" ]]
[[ "$(count_pushes_to 'user2-token')" -eq 1 ]]

# Only the (idempotent) duo_reaction stanza was delivered, no inbox entry
received=$(curl -sX GET "http://localhost:3001/pop?id=user2")
[[ "$(jq -s -r '[.[] | keys[0]] | join(",")' <<< "$received")" == "duo_reaction" ]]

# The reactor's client has nothing to update either
received1=$(curl -sX GET "http://localhost:3001/pop?id=user1")
[[ "$(jq -s '[.[] | .duo_inbox_entry | select(. != null)] | length' <<< "$received1")" -eq 0 ]]


echo "Changing the emoji notifies again but keeps one outstanding unread bump"

send_reaction_as user1 "$user2uuid" "$mam_id" "$emoji2"

[[ "$(inbox_row "$user2uuid" "$user1uuid")" == "${body1}|${emoji2}|1" ]]
[[ "$(count_pushes_to 'user2-token')" -eq 2 ]]

# The partner got a fresh inbox entry ahead of the replacement reaction
received=$(curl -sX GET "http://localhost:3001/pop?id=user2")
[[ "$(jq -s -r '[.[] | keys[0]] | join(",")' <<< "$received")" \
    == "duo_inbox_entry,duo_reaction" ]]

# The reactor's preview follows the replacement too
received1=$(curl -sX GET "http://localhost:3001/pop?id=user1")
entry1=$(jq -s '[.[] | .duo_inbox_entry | select(. != null)][0]' <<< "$received1")
[[ "$(jq -r '.last_message' <<< "$entry1")" == "Reacted ${emoji2} to: ${body1}" ]]


echo "Clearing a reaction reverts both previews, without a push"

send_reaction_as user1 "$user2uuid" "$mam_id" ""

# The reaction is gone from the archive and from both inbox rows; the
# partner's unread bump is retracted; no push was sent
[[ "$(q "select count(*) from mam_message where reaction is not null")" -eq 0 ]]
[[ "$(inbox_row "$user2uuid" "$user1uuid")" == "${body1}||0" ]]
[[ "$(inbox_row "$user1uuid" "$user2uuid")" == "${body1}||0" ]]
[[ "$(count_pushes_to 'user2-token')" -eq 2 ]]

# The partner's open client gets the reverted inbox entry, then the clear
# itself so it can drop the bubble
received=$(curl -sX GET "http://localhost:3001/pop?id=user2")
[[ "$(jq -s -r '[.[] | keys[0]] | join(",")' <<< "$received")" \
    == "duo_inbox_entry,duo_reaction" ]]

entry=$(jq -s '[.[] | .duo_inbox_entry | select(. != null)][0]' <<< "$received")
[[ "$(jq -r '.last_message' <<< "$entry")" == "${body1}" ]]
[[ "$(jq -r '.last_message_read' <<< "$entry")" == "true" ]]

# The reactor's preview reverts too
received1=$(curl -sX GET "http://localhost:3001/pop?id=user1")
entry1=$(jq -s '[.[] | .duo_inbox_entry | select(. != null)][0]' <<< "$received1")
[[ "$(jq -r '.last_message' <<< "$entry1")" == "${body1}" ]]


echo "A clear after a newer message changes nothing"

send_reaction_as user1 "$user2uuid" "$mam_id" "$emoji1"
[[ "$(inbox_row "$user2uuid" "$user1uuid")" == "${body1}|${emoji1}|1" ]]
[[ "$(count_pushes_to 'user2-token')" -eq 3 ]]

# A newer message supersedes the reaction as the latest activity
body_newer="a newer message from user 2"
send_message_as user2 "$user2uuid" "$user1uuid" "$body_newer"
[[ "$(inbox_row "$user2uuid" "$user1uuid")" == "${body_newer}||0" ]]

curl -sX GET "http://localhost:3001/pop?id=user2" > /dev/null

send_reaction_as user1 "$user2uuid" "$mam_id" ""

# The guarded clear proves the rows no longer reflect the cleared reaction,
# so neither inbox is touched: the partner only gets the bubble-clearing
# stanza and the reactor gets no entry
[[ "$(inbox_row "$user2uuid" "$user1uuid")" == "${body_newer}||0" ]]
received=$(curl -sX GET "http://localhost:3001/pop?id=user2")
[[ "$(jq -s -r '[.[] | keys[0]] | join(",")' <<< "$received")" == "duo_reaction" ]]

received1=$(curl -sX GET "http://localhost:3001/pop?id=user1")
[[ "$(jq -s '[.[] | .duo_inbox_entry | select(. != null)] | length' <<< "$received1")" -eq 0 ]]


echo "A shadow-banned reactor only updates their own side"

body2="message from user 2 to user 3"
send_message_as user2 "$user2uuid" "$user3uuid" "$body2"

q "update person set shadow_banned_at = now() where id = ${user3id}"
sleep 6 # let the 5s shadow-ban cache expire

chat_auth_as user3 "$user3uuid" "$user3token"
mam_id_2=$(get_conversation_as user3 "$user2uuid" | mam_id_by_body "$body2")
[[ -n "$mam_id_2" && "$mam_id_2" != "null" ]]

curl -sX GET "http://localhost:3001/pop?id=user2" > /dev/null
clear_pushes

send_reaction_as user3 "$user2uuid" "$mam_id_2" "$emoji1"

# The reactor's own row shows the reaction so their app behaves normally,
# and their own client still gets its inbox entry...
[[ "$(inbox_row "$user3uuid" "$user2uuid")" == "${body2}|${emoji1}|0" ]]
received3=$(curl -sX GET "http://localhost:3001/pop?id=user3")
entry3=$(jq -s '[.[] | .duo_inbox_entry | select(. != null)][0]' <<< "$received3")
[[ "$(jq -r '.last_message' <<< "$entry3")" == "Reacted ${emoji1} to: ${body2}" ]]

# ...but the partner's row is untouched, and they got no stanzas and no push
[[ "$(inbox_row "$user2uuid" "$user3uuid")" == "${body2}||0" ]]
[[ "$(curl -sX GET "http://localhost:3001/pop?id=user2")" == "" ]]
[[ "$(count_pushes_to 'user2-token')" -eq 0 ]]
