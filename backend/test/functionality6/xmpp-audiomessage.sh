#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

snd1=$(rand_sound)

set -xe

sleep 3

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

set_difference () {
  comm -1 -3 <(sort <<< "$1") <(sort <<< "$2")
}

query_id () {
  local _query_id
  _query_id=$(cat /tmp/duo_query_id 2> /dev/null)

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

send_audio_messages () {
  local fromUuid=$1
  local fromToken=$2
  local toUuid=$3

  local messages=("${@:4}")

  chat_auth "$fromUuid" "$fromToken"

  sleep 1

  for message in "${messages[@]}"; do
    read -r -d '' payload <<EOF || true
{
  "message": {
    "@type": "chat",
    "@from": "${fromUuid}@duolicious.app",
    "@to": "${toUuid}@duolicious.app",
    "@id": "id1",
    "@xmlns": "jabber:client",
    "@audio_base64": "${message}"
  }
}
EOF

  curl -X POST http://localhost:3001/send -H "Content-Type: application/json" -d "$payload"
  done

  sleep 1
}

# Extract the stanza id from the first element of a JSON array.
get_first_stanza_id () {
  # Assumes the JSON input is an array; it selects the first element and extracts its result id.
  jq -s -r '
  .[0] |
  if .message.result and .message.result["@id"] then
    .message.result["@id"]
  else
    empty
  end |
  gsub("\n"; "")
'
}

# Assert that the final stanza in the JSON response is a FIN stanza.
# It checks that the last element is an IQ stanza with the given id,
# that its type is "result", and that it contains a "fin" subelement.
assert_fin () {
  local id=$1
  # .[-1] selects the last element of the array. The three select filters ensure that:
  # - the IQ element’s "@id" matches the provided id,
  # - the type is "result",
  # - and there is a "fin" key present.
  jq -s -e '.[-1] | select(.iq["@id"]=="'"$id"'") | select(.iq["@type"]=="result") | select(.iq.fin != null)' >/dev/null
}

# Main function to get a conversation and page through results.
# This version sends a JSON query (the converted equivalent of your XML query)
# and processes the JSON response with jq.
get_conversation () {
  local userUuid=$1
  local userToken=$2
  local otherPersonUuid=$3
  local pageSize=${4:-3}

  chat_auth "$userUuid" "$userToken"
  sleep 1
  curl -sX GET http://localhost:3001/pop > /dev/null
  sleep 0.5

  local beforeId=''
  local all_pages=""

  while true; do
    local queryId
    queryId=$(next_query_id)

    local query
    query=$(cat <<EOF
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
          {
            "@var": "FORM_TYPE",
            "value": "urn:xmpp:mam:2"
          },
          {
            "@var": "with",
            "value": "${otherPersonUuid}@duolicious.app"
          }
        ]
      },
      "set": {
        "@xmlns": "http://jabber/protocol/rsm",
        "max": "${pageSize}",
        "before": "${beforeId}"
      }
    }
  }
}
EOF
)

    curl -X POST http://localhost:3001/send -H "Content-Type: application/json" -d "$query"
    sleep 0.2

    local response
    response=$(curl -sX GET http://localhost:3001/pop)

    # Assert and update beforeId using slurp mode (this combines multiple JSON objects into one array)
    assert_fin "$queryId" <<< "$response"

    beforeId=$(get_first_stanza_id <<< "$response")

    # Process and redact sensitive fields using jq (this outputs a JSON array)
    local processed

    processed=$(echo "$response" | jq -s 'map(
      if has("message") then
        .message["@id"] = "redacted" |
        (if (.message | has("result")) then .message.result["@id"] = "redacted" else . end) |
        (if (.message.result | has("forwarded")) then
           .message.result.forwarded.delay["@stamp"] = "redacted" |
           .message.result.forwarded.message["@id"] = "redacted" |
           .message.result.forwarded.message["@audio_uuid"] = "redacted"
         else . end)
      else
        .
      end
    )')

    # Append the processed page to the accumulator variable (each page is a JSON array)
    all_pages="${all_pages}"$'\n'"${processed}"

    if [[ -z "$beforeId" ]]; then
      break
    fi
  done

  # Combine all JSON arrays into a single JSON array
  echo "$all_pages" | jq -s 'add'
}



say "References to audio files are stored in MAM"

send_audio_messages "$user1uuid" "$user1token" "$user2uuid" \
  "$snd1"

send_audio_messages "$user1uuid" "$user1token" "$user3uuid" \
  "$snd1"

curl -sX GET http://localhost:3001/pop > /dev/null

query_id_1=$(query_id)
actual_conversation_1_2=$(get_conversation "$user1uuid" "$user1token" "$user2uuid")

query_id_2=$(query_id)
actual_conversation_2_1=$(get_conversation "$user2uuid" "$user2token" "$user1uuid")

query_id_3=$(query_id)
actual_conversation_1_3=$(get_conversation "$user1uuid" "$user1token" "$user3uuid")



expected_conversation_1_2=$(cat << EOF
[
  {
    "message": {
      "@xmlns": "jabber:client",
      "@from": "${user1uuid}@duolicious.app",
      "@to": "${user1uuid}@duolicious.app",
      "@id": "redacted",
      "result": {
        "@xmlns": "urn:xmpp:mam:2",
        "@queryid": "$(( query_id_1 + 1 ))",
        "@id": "redacted",
        "forwarded": {
          "@xmlns": "urn:xmpp:forward:0",
          "delay": {
            "@xmlns": "urn:xmpp:delay",
            "@stamp": "redacted"
          },
          "message": {
            "@xmlns": "jabber:client",
            "@from": "${user1uuid}@duolicious.app",
            "@id": "redacted",
            "@to": "${user2uuid}@duolicious.app",
            "@type": "chat",
            "@audio_uuid": "redacted",
            "body": "Voice message\n                                                                                                                                \nUpgrade to the latest version of Duolicious to hear this message",
            "request": {
              "@xmlns": "urn:xmpp:receipts"
            }
          }
        }
      }
    }
  },
  {
    "iq": {
      "@xmlns": "jabber:client",
      "@from": "${user1uuid}@duolicious.app",
      "@to": "${user1uuid}@duolicious.app",
      "@id": "$(( query_id_1 + 1 ))",
      "@type": "result",
      "fin": {
        "@xmlns": "urn:xmpp:mam:2"
      }
    }
  },
  {
    "iq": {
      "@xmlns": "jabber:client",
      "@from": "${user1uuid}@duolicious.app",
      "@to": "${user1uuid}@duolicious.app",
      "@id": "$(( query_id_1 + 2 ))",
      "@type": "result",
      "fin": {
        "@xmlns": "urn:xmpp:mam:2"
      }
    }
  }
]
EOF
)

expected_conversation_2_1=$(cat << EOF
[
  {
    "message": {
      "@xmlns": "jabber:client",
      "@from": "${user2uuid}@duolicious.app",
      "@to": "${user2uuid}@duolicious.app",
      "@id": "redacted",
      "result": {
        "@xmlns": "urn:xmpp:mam:2",
        "@queryid": "$(( query_id_2 + 1 ))",
        "@id": "redacted",
        "forwarded": {
          "@xmlns": "urn:xmpp:forward:0",
          "delay": {
            "@xmlns": "urn:xmpp:delay",
            "@stamp": "redacted"
          },
          "message": {
            "@xmlns": "jabber:client",
            "@from": "${user1uuid}@duolicious.app",
            "@id": "redacted",
            "@to": "${user2uuid}@duolicious.app",
            "@type": "chat",
            "@audio_uuid": "redacted",
            "body": "Voice message\n                                                                                                                                \nUpgrade to the latest version of Duolicious to hear this message",
            "request": {
              "@xmlns": "urn:xmpp:receipts"
            }
          }
        }
      }
    }
  },
  {
    "iq": {
      "@xmlns": "jabber:client",
      "@from": "${user2uuid}@duolicious.app",
      "@to": "${user2uuid}@duolicious.app",
      "@id": "$(( query_id_2 + 1 ))",
      "@type": "result",
      "fin": {
        "@xmlns": "urn:xmpp:mam:2"
      }
    }
  },
  {
    "iq": {
      "@xmlns": "jabber:client",
      "@from": "${user2uuid}@duolicious.app",
      "@to": "${user2uuid}@duolicious.app",
      "@id": "$(( query_id_2 + 2 ))",
      "@type": "result",
      "fin": {
        "@xmlns": "urn:xmpp:mam:2"
      }
    }
  }
]
EOF
)

expected_conversation_1_3=$(cat << EOF
[
  {
    "message": {
      "@xmlns": "jabber:client",
      "@from": "${user1uuid}@duolicious.app",
      "@to": "${user1uuid}@duolicious.app",
      "@id": "redacted",
      "result": {
        "@xmlns": "urn:xmpp:mam:2",
        "@queryid": "$(( query_id_3 + 1 ))",
        "@id": "redacted",
        "forwarded": {
          "@xmlns": "urn:xmpp:forward:0",
          "delay": {
            "@xmlns": "urn:xmpp:delay",
            "@stamp": "redacted"
          },
          "message": {
            "@xmlns": "jabber:client",
            "@from": "${user1uuid}@duolicious.app",
            "@id": "redacted",
            "@to": "${user3uuid}@duolicious.app",
            "@type": "chat",
            "@audio_uuid": "redacted",
            "body": "Voice message\n                                                                                                                                \nUpgrade to the latest version of Duolicious to hear this message",
            "request": {
              "@xmlns": "urn:xmpp:receipts"
            }
          }
        }
      }
    }
  },
  {
    "iq": {
      "@xmlns": "jabber:client",
      "@from": "${user1uuid}@duolicious.app",
      "@to": "${user1uuid}@duolicious.app",
      "@id": "$(( query_id_3 + 1 ))",
      "@type": "result",
      "fin": {
        "@xmlns": "urn:xmpp:mam:2"
      }
    }
  },
  {
    "iq": {
      "@xmlns": "jabber:client",
      "@from": "${user1uuid}@duolicious.app",
      "@to": "${user1uuid}@duolicious.app",
      "@id": "$(( query_id_3 + 2 ))",
      "@type": "result",
      "fin": {
        "@xmlns": "urn:xmpp:mam:2"
      }
    }
  }
]
EOF
)

diff -u --color <(echo "actual") <(echo "expected") || true
diff -u --color <(echo "$actual_conversation_1_2") <(echo "$expected_conversation_1_2")
diff -u --color <(echo "$actual_conversation_2_1") <(echo "$expected_conversation_2_1")
diff -u --color <(echo "$actual_conversation_1_3") <(echo "$expected_conversation_1_3")



say "Audio files are only removed after the last user deletes their account"

mapfile -t remaining_audio_uuids_0 < <(q "select distinct audio_uuid from mam_message")
[ "${#remaining_audio_uuids_0[@]}" -eq 2 ]
wait_for_audio_creation_by_uuid "${remaining_audio_uuids_0[@]}"




assume_role user1
c DELETE /account

mapfile -t remaining_audio_uuids_1 < <(q "select distinct audio_uuid from mam_message")
[ "${#remaining_audio_uuids_1[@]}" -eq 2 ]
wait_for_audio_creation_by_uuid "${remaining_audio_uuids_1[@]}"




assume_role user2
c DELETE /account

mapfile -t remaining_audio_uuids_2 < <(q "select distinct audio_uuid from mam_message")
deleted_uuids_2=$(
  set_difference \
    "$(printf "%s\n" "${remaining_audio_uuids_2[@]}")" \
    "$(printf "%s\n" "${remaining_audio_uuids_1[@]}")"
)
[ "${#remaining_audio_uuids_2[@]}" -eq 1 ]
[ -n "${deleted_uuids_2}" ]
wait_for_audio_deletion_by_uuid "${deleted_uuids_2}"
wait_for_audio_creation_by_uuid "${remaining_audio_uuids_2[@]}"



assume_role user3
c DELETE /account

mapfile -t remaining_audio_uuids_3 < <(q "select distinct audio_uuid from mam_message")
deleted_uuids_3=$(
  set_difference \
    "$(printf "%s\n" "${remaining_audio_uuids_3[@]}")" \
    "$(printf "%s\n" "${remaining_audio_uuids_2[@]}")"
)
[ "${#remaining_audio_uuids_3[@]}" -eq 0 ]
[ -n "${deleted_uuids_3}" ]
wait_for_audio_deletion_by_uuid "${deleted_uuids_3}"
