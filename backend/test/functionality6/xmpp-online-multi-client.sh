#!/usr/bin/env bash

# Purpose: online status must account for users connected via multiple clients
# at once (e.g. two browser tabs). Dropping one of several connections must
# not demote the user to 'online-recently'; only losing the last connection
# does. 'online' means at least one client is connected.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

sleep 3 # Allow services to flush startup tasks

q "delete from person"
q "delete from duo_session"

../util/create-user.sh multi  0 0
../util/create-user.sh viewer 0 0

assume_role multi  ; multi_token=$SESSION_TOKEN
assume_role viewer ; viewer_token=$SESSION_TOKEN

multi_uuid=$(get_uuid 'multi@example.com')
viewer_uuid=$(get_uuid 'viewer@example.com')

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Like setup.sh's chat_auth, but on a named harness connection so the same
# user can hold several connections at once.
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
    -d '{ "server": "ws://chat:5443" }'

  sleep 0.2

  curl -sX POST "http://localhost:3001/send?id=${connectionId}" \
    -H "Content-Type: application/json" \
    -d "$authJson"

  sleep 1

  curl -sX GET "http://localhost:3001/pop?id=${connectionId}" > /dev/null
}

disconnect () {
  local connectionId=$1

  curl -sX POST "http://localhost:3001/disconnect?id=${connectionId}"

  sleep 2
}

# Subscribing (or re-subscribing) always returns a duo_online_event carrying
# multi's current status.
subscribe_to_multi () {
  curl -sX POST "http://localhost:3001/send?id=viewer" \
    -H "Content-Type: application/json" \
    -d "{ \"duo_subscribe_online\": { \"@uuid\": \"${multi_uuid}\" } }"

  sleep 1
}

pop_viewer () {
  curl -sX GET "http://localhost:3001/pop?id=viewer"
}

# ---------------------------------------------------------------------------
# 1) Baseline: connecting pushes 'online'
# ---------------------------------------------------------------------------

chat_auth_as viewer "$viewer_uuid" "$viewer_token"
subscribe_to_multi

echo "The subscription reports 'offline' while multi has no connections"
pop_viewer | grep -q '"@status": "offline"' \
  || { echo "Expected an 'offline' status"; exit 1; }

echo "Multi's first connection pushes 'online'"
chat_auth_as multi1 "$multi_uuid" "$multi_token"
sleep 1
pop_viewer | grep -q '"@status": "online"' \
  || { echo "Expected an 'online' event"; exit 1; }

# ---------------------------------------------------------------------------
# 2) Dropping one of two connections keeps the user 'online'
# ---------------------------------------------------------------------------

chat_auth_as multi2 "$multi_uuid" "$multi_token"
sleep 1
pop_viewer > /dev/null

echo "Dropping one of two connections must not demote multi"
disconnect multi2
events=$(pop_viewer)

echo "$events" | grep -q 'online-recently' \
  && { echo "Did not expect an 'online-recently' event"; exit 1; } || true

echo "A fresh subscription still reports 'online'"
subscribe_to_multi
pop_viewer | grep -q '"@status": "online"' \
  || { echo "Expected an 'online' status"; exit 1; }

# ---------------------------------------------------------------------------
# 3) Dropping the last connection demotes the user to 'online-recently'
# ---------------------------------------------------------------------------

echo "Dropping the last connection demotes multi to 'online-recently'"
disconnect multi1
pop_viewer | grep -q '"@status": "online-recently"' \
  || { echo "Expected an 'online-recently' event"; exit 1; }
