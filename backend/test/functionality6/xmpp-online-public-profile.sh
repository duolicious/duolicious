#!/usr/bin/env bash

# Purpose: online-status subscriptions must respect `public_profile` for
# logged-out (unauthenticated) viewers, keep working for authenticated viewers
# (honouring skips), and be capped per connection so a single client can't open
# an unbounded number of subscriptions.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

# The cap is shrunk via a test/input override (only honoured when mocking is on)
# so the limit can be exercised with a handful of users. Always clean it up.
max_subs_file=../../test/input/max-online-subscriptions
rm -f "$max_subs_file"
trap 'rm -f "$max_subs_file"' EXIT

sleep 3 # Allow services to flush startup tasks

q "delete from person"
q "delete from duo_session"
q "delete from skipped"

../util/create-user.sh viewer 0 0   # authenticated viewer
../util/create-user.sh pub    0 0   # public profile
../util/create-user.sh priv   0 0   # non-public profile
../util/create-user.sh blockd 0 0   # public, but skipped by the viewer
../util/create-user.sh capa   0 0   # public, for the cap test
../util/create-user.sh capb   0 0   # public, for the cap test
../util/create-user.sh hidden 0 0   # public, but hides their online status

q "
update person
set public_profile = true
where email in (
  'pub@example.com',
  'blockd@example.com',
  'capa@example.com',
  'capb@example.com',
  'hidden@example.com'
)"

q "
update person
set show_my_online_status = false
where email = 'hidden@example.com'"

q "
update person
set public_profile = false
where email in ('priv@example.com', 'viewer@example.com')"

assume_role viewer
viewer_token=$SESSION_TOKEN
viewer_uuid=$USER_UUID
viewer_id=$PERSON_ID

pub_uuid=$(get_uuid 'pub@example.com')
priv_uuid=$(get_uuid 'priv@example.com')
blockd_uuid=$(get_uuid 'blockd@example.com')
blockd_id=$(get_id 'blockd@example.com')
capa_uuid=$(get_uuid 'capa@example.com')
capb_uuid=$(get_uuid 'capb@example.com')
hidden_uuid=$(get_uuid 'hidden@example.com')

# The viewer has skipped `blockd`, so an authenticated subscription to them must
# be refused even though `blockd` has a public profile.
q "
insert into skipped (subject_person_id, object_person_id)
values (${viewer_id}, ${blockd_id})"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Open a fresh, unauthenticated chat websocket connection.
open_anon () {
  curl -sX POST http://localhost:3001/config \
    -H "Content-Type: application/json" \
    -d '{ "server": "ws://api:5000/chat" }' > /dev/null
  sleep 0.5
}

# Send a duo_subscribe_online stanza for the given person uuid.
send_subscribe () {
  local uuid=$1

  read -r -d '' payload <<EOF || true
{ "duo_subscribe_online": { "@uuid": "${uuid}" } }
EOF

  curl -sX POST http://localhost:3001/send \
    -H "Content-Type: application/json" \
    -d "$payload" > /dev/null
}

# Discard anything the connection has received so far.
drain () {
  curl -sX GET http://localhost:3001/pop > /dev/null
}

# Subscribe to a uuid and return the connection's response stanzas.
subscribe_and_pop () {
  local uuid=$1

  drain
  send_subscribe "$uuid"
  sleep 1
  curl -sX GET http://localhost:3001/pop
}

assert_subscribed () {
  echo "$1" | grep -q duo_subscribe_successful \
    || { echo "Expected duo_subscribe_successful"; exit 1; }
}

assert_not_subscribed () {
  echo "$1" | grep -q duo_subscribe_unsuccessful \
    || { echo "Expected duo_subscribe_unsuccessful"; exit 1; }
  echo "$1" | grep -q duo_subscribe_successful \
    && { echo "Did not expect duo_subscribe_successful"; exit 1; } || true
}

# ---------------------------------------------------------------------------
# 1) Logged-out (unauthenticated) viewer
# ---------------------------------------------------------------------------

echo "A logged-out viewer can subscribe to a public profile's online status"
open_anon
assert_subscribed "$(subscribe_and_pop "$pub_uuid")"

echo "A logged-out viewer cannot subscribe to a non-public profile"
open_anon
assert_not_subscribed "$(subscribe_and_pop "$priv_uuid")"

echo "A logged-out viewer cannot subscribe to someone who hides their online status"
open_anon
assert_not_subscribed "$(subscribe_and_pop "$hidden_uuid")"

# ---------------------------------------------------------------------------
# 2) Authenticated viewer (unchanged behaviour)
# ---------------------------------------------------------------------------

echo "An authenticated viewer can subscribe to a non-public profile"
chat_auth "$viewer_uuid" "$viewer_token"
sleep 1
assert_subscribed "$(subscribe_and_pop "$priv_uuid")"

echo "An authenticated viewer cannot subscribe to someone they've skipped"
chat_auth "$viewer_uuid" "$viewer_token"
sleep 1
assert_not_subscribed "$(subscribe_and_pop "$blockd_uuid")"

echo "An authenticated viewer cannot subscribe to someone who hides their online status"
chat_auth "$viewer_uuid" "$viewer_token"
sleep 1
assert_not_subscribed "$(subscribe_and_pop "$hidden_uuid")"

# ---------------------------------------------------------------------------
# 3) Per-connection subscription cap evicts the earliest subscriptions
# ---------------------------------------------------------------------------

# Publish an "online" event for a person directly onto their redis channel,
# exactly as the chat service does when that person signs in. Only connections
# still subscribed to the channel receive it. Uses the RESP multi-bulk format so
# the payload (which contains spaces) survives intact. The chat service now
# carries a protocol-neutral bus payload on the wire, which the forwarder
# renders per connection, so we publish that JSON rather than raw XML.
publish_online () {
  local uuid=$1
  local channel="online-${uuid}"
  local message="{\"kind\": \"OnlineEvent\", \"username\": \"${uuid}\", \"status\": \"online\"}"

  local payload
  printf -v payload '*3\r\n$7\r\nPUBLISH\r\n$%s\r\n%s\r\n$%s\r\n%s\r\n' \
    "${#channel}" "$channel" "${#message}" "$message"

  exec 3<>"/dev/tcp/${DUO_REDIS_HOST:-localhost}/${DUO_REDIS_PORT:-6379}"
  printf '%s' "$payload" >&3
  read -r -u 3 -t 5 _reply
  exec 3>&- 3<&-
}

echo "Subscriptions beyond the per-connection cap evict the earliest, not the newest"

# Shrink the cap to 2, then subscribe to three distinct public profiles on a
# single connection. All three succeed; subscribing to capb evicts pub (the
# earliest).
printf 2 > "$max_subs_file"
sleep 2 # Outlive the 1s cache window for the override

open_anon
drain

send_subscribe "$pub_uuid"
sleep 1
send_subscribe "$capa_uuid"
sleep 1
send_subscribe "$capb_uuid"
sleep 1

responses=$(curl -sX GET http://localhost:3001/pop)

num_ok=$(echo "$responses" | grep -c duo_subscribe_successful || true)
num_bad=$(echo "$responses" | grep -c duo_subscribe_unsuccessful || true)

[[ "$num_ok" -eq 3 ]] \
  || { echo "Expected 3 successful subscriptions, got $num_ok"; exit 1; }

[[ "$num_bad" -eq 0 ]] \
  || { echo "Expected 0 refused subscriptions, got $num_bad"; exit 1; }

# Prove the eviction actually happened: a now-online event for the evicted
# profile (pub) must NOT reach this connection, while one for a profile still
# subscribed (capb) must.
drain
publish_online "$pub_uuid"
publish_online "$capb_uuid"
sleep 1
events=$(curl -sX GET http://localhost:3001/pop)

echo "$events" | grep -q "$capb_uuid" \
  || { echo "Expected an online event for a still-subscribed profile"; exit 1; }

echo "$events" | grep -q "$pub_uuid" \
  && { echo "Did not expect an online event for the evicted profile"; exit 1; } || true

echo "Hiding online status pushes an immediate offline event to subscribers"

chat_auth "$viewer_uuid" "$viewer_token"
sleep 1
assert_subscribed "$(subscribe_and_pop "$pub_uuid")"

drain
publish_online "$pub_uuid"
sleep 1
curl -sX GET http://localhost:3001/pop | grep -q "$pub_uuid" \
  || { echo "Expected pub's online event to reach the subscriber"; exit 1; }

drain
assume_role pub
jc PATCH /profile-info -d '{ "show_my_online_status": "No" }'
sleep 1
offline_events=$(curl -sX GET http://localhost:3001/pop)

echo "$offline_events" | grep -q "$pub_uuid" \
  || { echo "Expected pub's offline event to reach the subscriber"; exit 1; }
echo "$offline_events" | grep -q offline \
  || { echo "Expected pub to be reported offline after hiding"; exit 1; }

echo "Un-hiding online status re-publishes their status to subscribers"

drain
jc PATCH /profile-info -d '{ "show_my_online_status": "Yes" }'
sleep 1
unhidden_events=$(curl -sX GET http://localhost:3001/pop)

echo "$unhidden_events" | grep -q "$pub_uuid" \
  || { echo "Expected pub's status event to reach the subscriber after un-hiding"; exit 1; }
echo "$unhidden_events" | grep -q offline \
  && { echo "Did not expect pub to be offline after un-hiding"; exit 1; } || true
