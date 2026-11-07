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
q "delete from messaged"
q "delete from intro_hash"

../util/create-user.sh sender 0 0
../util/create-user.sh polite 0 0
../util/create-user.sh rude 0 0
../util/create-user.sh recipient 0 0

q "update person set sign_up_time = now() - interval '7 days'"

q "update person
   set intros_notification = 1, chats_notification = 1,
       intro_seconds = 0, chat_seconds = 0"

assume_role sender ; sendertoken=$SESSION_TOKEN
assume_role polite ; politetoken=$SESSION_TOKEN
assume_role rude ; rudetoken=$SESSION_TOKEN
assume_role recipient ; recipienttoken=$SESSION_TOKEN

senderuuid=$(get_uuid 'sender@example.com')
politeuuid=$(get_uuid 'polite@example.com')
rudeuuid=$(get_uuid 'rude@example.com')
recipientuuid=$(get_uuid 'recipient@example.com')

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

# The recipient's view of its conversation with the given person, from the
# latest live inbox entry, as "location|hidden|last_message_read".
entry_fields () {
  local received=$1
  jq -sr '
    [.[] | .duo_inbox_entry | select(. != null)][-1]
    | "\(.location)|\(.hidden)|\(.last_message_read)"
  ' <<< "$received"
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

# The mam_id of the message with the given body in the conversation with the
# given person, from the connection's own archive.
mam_id_of () {
  local connectionId=$1
  local otherPersonUuid=$2
  local body=$3

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

  curl -sX GET "http://localhost:3001/pop?id=${connectionId}" | jq -rs '[ .[]
    | select(.message.result.forwarded.message.body == "'"$body"'")
    | .message.result["@id"]
  ] | .[0]'
}

message_checks_for () {
  q "select count(*) from notification_due
     where kind = 'intro'
     and person_id = (select id from person where uuid::text = '$1')"
}

snapshot_fields () {
  local connectionId=$1
  local personUuid=$2
  query_inbox_snapshot_as "$connectionId" | jq -sr '
    [.[] | .duo_inbox | select(. != null)][0]
    | .conversations[]
    | select(.person_uuid == "'"$personUuid"'")
    | "\(.location)|\(.hidden)|\(.last_message_read)"
  '
}

chat_auth_as sender "$senderuuid" "$sendertoken"
chat_auth_as polite "$politeuuid" "$politetoken"
chat_auth_as rude "$rudeuuid" "$rudetoken"
chat_auth_as recipient "$recipientuuid" "$recipienttoken"

register_push_token_as recipient 'recipient-token'

clear_pushes
curl -sX GET "http://localhost:3001/pop?id=recipient" > /dev/null



echo "A rude intro arrives hidden, already read, with no push"

send_message_as sender "$senderuuid" "$recipientuuid" "ur tiddies look nice"

received=$(curl -sX GET "http://localhost:3001/pop?id=recipient")
[[ "$(entry_fields "$received")" == "intros|true|true" ]]
[[ "$(snapshot_fields recipient "$senderuuid")" == "intros|true|true" ]]
[[ "$(count_pushes_to 'recipient-token')" -eq 0 ]]
[[ "$(message_checks_for "$recipientuuid")" -eq 0 ]]



echo "A polite follow-up to a hidden intro stays hidden and silent"

send_message_as sender "$senderuuid" "$recipientuuid" "sorry, hope your week is going well"

received=$(curl -sX GET "http://localhost:3001/pop?id=recipient")
[[ "$(entry_fields "$received")" == "intros|true|true" ]]
[[ "$(count_pushes_to 'recipient-token')" -eq 0 ]]
[[ "$(q "select unread_count from inbox
         where luser = '${recipientuuid}'
         and remote_bare_jid = '${senderuuid}@duolicious.app'")" -eq 0 ]]
[[ "$(message_checks_for "$recipientuuid")" -eq 0 ]]



echo "A polite intro isn't hidden"

send_message_as polite "$politeuuid" "$recipientuuid" "Your answer about road trips made me laugh"

received=$(curl -sX GET "http://localhost:3001/pop?id=recipient")
[[ "$(entry_fields "$received")" == "intros|false|false" ]]
[[ "$(count_pushes_to 'recipient-token')" -eq 1 ]]
[[ "$(message_checks_for "$recipientuuid")" -eq 1 ]]



echo "Replying to a hidden intro turns it into an ordinary chat"

send_message_as recipient "$recipientuuid" "$senderuuid" "please be nicer"
send_message_as sender "$senderuuid" "$recipientuuid" "ok fair"

received=$(curl -sX GET "http://localhost:3001/pop?id=recipient")
[[ "$(entry_fields "$received")" == "chats|false|false" ]]
[[ "$(count_pushes_to 'recipient-token')" -eq 2 ]]



echo "Reacting to a hidden intro turns it into an ordinary chat"

send_message_as rude "$rudeuuid" "$recipientuuid" "ur tiddies are so hot"

received=$(curl -sX GET "http://localhost:3001/pop?id=recipient")
[[ "$(entry_fields "$received")" == "intros|true|true" ]]
[[ "$(count_pushes_to 'recipient-token')" -eq 2 ]]

mam_id=$(mam_id_of recipient "$rudeuuid" "ur tiddies are so hot")
[[ -n "$mam_id" && "$mam_id" != "null" ]]

send_reaction_as recipient "$rudeuuid" "$mam_id" '👎'

[[ "$(snapshot_fields recipient "$rudeuuid")" == "chats|false|true" ]]

send_message_as rude "$rudeuuid" "$recipientuuid" "ok sorry"

received=$(curl -sX GET "http://localhost:3001/pop?id=recipient")
[[ "$(entry_fields "$received")" == "chats|false|false" ]]
[[ "$(count_pushes_to 'recipient-token')" -eq 3 ]]
