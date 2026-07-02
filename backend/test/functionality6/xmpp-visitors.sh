#!/usr/bin/env bash

# Purpose: end-to-end coverage for the real-time visitors feature delivered over
# the chat WebSocket. Viewing a profile (a normal REST call) must:
#
#   * push a live `duo_visitor` (section `you_visited`) to the *viewer's*
#     connection -- so the "you visited" page updates in real time; and
#   * push a live `duo_visitor` (section `visited_you`) to the *prospect's*
#     connection, but only when the prospect is currently online -- so the
#     "visited you" page updates in real time without running the expensive
#     per-visitor query for people who aren't around to see it.
#
# A connection can also pull a `duo_query_visitors` snapshot and acknowledge it
# with `duo_mark_visitors_checked`, replacing the removed `GET /visitors` and
# `POST /mark-visitors-checked` REST endpoints.
#
# Crucially, the "Browse Invisibly" privacy option must be respected by the live
# push: an invisible viewer still sees their own `you_visited` update, but the
# prospect must never be told they were `visited_you`.
#
# Only one chat WebSocket connection is available to the test harness at a time
# (the `chatjsontest` mock holds a single socket), so each case connects as
# whichever side is expected to *receive* a push and drives the visit from the
# other side over plain REST.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

sleep 3 # Allow services to flush startup tasks

q "delete from person"
q "delete from duo_session"
q "delete from skipped"
q "delete from visited"

../util/create-user.sh viewer   0 0
../util/create-user.sh prospect 0 0

# Privacy gating (verification levels) would otherwise blank out fields and
# complicate the assertions; this feature is tested separately.
q "update person set privacy_verification_level_id = 1"

assume_role viewer   ; viewer_token=$SESSION_TOKEN
assume_role prospect ; prospect_token=$SESSION_TOKEN

viewer_uuid=$(get_uuid 'viewer@example.com')
prospect_uuid=$(get_uuid 'prospect@example.com')
viewer_id=$(get_id 'viewer@example.com')
prospect_id=$(get_id 'prospect@example.com')

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Record a profile view (which is what actually writes the `visited` row and
# fires the live push) as a specific user, over plain REST. The chat connection
# belongs to whoever we expect to *receive* the resulting push, so the visit is
# always driven through a token rather than the connected session.
visit_as () {
  local token=$1
  local uuid=$2

  local prev=$SESSION_TOKEN
  SESSION_TOKEN=$token
  c GET "/prospect-profile/${uuid}" > /dev/null
  SESSION_TOKEN=$prev
}

# Send a JSON stanza over the currently-configured chat connection.
send_json () {
  curl -sX POST http://localhost:3001/send \
    -H "Content-Type: application/json" \
    -d "$1" > /dev/null
}

# Discard anything the connection has buffered so far.
drain () {
  curl -sX GET http://localhost:3001/pop > /dev/null
}

# Poll `/pop` (which clears its buffer on each read) until `pattern` shows up in
# the accumulated output, or we give up. Echoes everything seen so far so the
# caller can make further assertions / print it on failure.
pop_until () {
  local pattern=$1
  local tries=${2:-12} # ~0.5s each
  local acc=""
  local i=0

  while (( i < tries )); do
    acc+=$(curl -sX GET http://localhost:3001/pop)
    acc+=$'\n'

    if echo "$acc" | grep -Eq "$pattern"; then
      printf '%s' "$acc"
      return 0
    fi

    sleep 0.5
    (( i += 1 )) || true
  done

  printf '%s' "$acc"
  return 1
}

assert_contains () {
  echo "$1" | grep -Eq "$2" \
    || { echo "Expected to find /$2/ in:"; echo "$1"; exit 1; }
}

assert_absent () {
  echo "$1" | grep -Eq "$2" \
    && { echo "Did not expect /$2/ in:"; echo "$1"; exit 1; } || true
}

# Decode the JSON payload carried by the most recent `duo_visitors` snapshot
# stanza in the accumulated `/pop` output (read from stdin).
snapshot_payload () {
  jq -s '[ .[] | select(has("duo_visitors")) ] | last | .duo_visitors | fromjson'
}

# Extract a field from the first `duo_visitor` push stanza (read from stdin).
# Usage: visitor_field '@section'   or   visitor_field item .person_uuid
visitor_field () {
  if [[ "$1" == item ]]; then
    jq -s '[ .[] | select(has("duo_visitor")) ] | first | .duo_visitor."#text" | fromjson'"$2"
  else
    jq -s -r '[ .[] | select(has("duo_visitor")) ] | first | .duo_visitor["'"$1"'"]'
  fi
}

# ---------------------------------------------------------------------------
# 1) `duo_query_visitors` returns the same snapshot the REST endpoint serves
# ---------------------------------------------------------------------------

snapshot_over_websocket () {
  q "delete from visited"

  # Reciprocal visits: viewer -> prospect (you_visited) and
  # prospect -> viewer (visited_you), both from the viewer's point of view.
  visit_as "$viewer_token"   "$prospect_uuid"
  visit_as "$prospect_token" "$viewer_uuid"

  chat_auth "$viewer_uuid" "$viewer_token"
  sleep 1
  drain

  send_json '{ "duo_query_visitors": {} }'

  local out
  out=$(pop_until 'duo_visitors')

  assert_contains "$out" 'duo_visitors'

  local payload
  payload=$(echo "$out" | snapshot_payload)

  [[ "$(echo "$payload" | jq '.visited_you | length')" -eq 1 ]] \
    || { echo "Expected one visited_you entry"; echo "$payload"; exit 1; }
  [[ "$(echo "$payload" | jq '.you_visited | length')" -eq 1 ]] \
    || { echo "Expected one you_visited entry"; echo "$payload"; exit 1; }

  [[ "$(echo "$payload" | jq -r '.visited_you[0].person_uuid')" == "$prospect_uuid" ]] \
    || { echo "visited_you should describe the prospect"; exit 1; }
  [[ "$(echo "$payload" | jq -r '.you_visited[0].person_uuid')" == "$prospect_uuid" ]] \
    || { echo "you_visited should describe the prospect"; exit 1; }

}

# ---------------------------------------------------------------------------
# 2) Visiting a profile pushes a live `you_visited` event to the viewer
# ---------------------------------------------------------------------------

you_visited_pushed_to_viewer () {
  q "delete from visited"

  chat_auth "$viewer_uuid" "$viewer_token"
  sleep 1
  drain

  visit_as "$viewer_token" "$prospect_uuid"

  local out
  out=$(pop_until 'duo_visitor"|duo_visitor ')

  assert_contains "$out" 'duo_visitor'

  [[ "$(echo "$out" | visitor_field '@section')" == 'you_visited' ]] \
    || { echo "Expected a you_visited push"; echo "$out"; exit 1; }

  # The pushed item describes the person who was visited (the prospect), and
  # carries the same shape as a snapshot row.
  [[ "$(echo "$out" | visitor_field item .person_uuid | tr -d '"')" == "$prospect_uuid" ]] \
    || { echo "you_visited item should describe the prospect"; echo "$out"; exit 1; }

  # A `last_visited_at` cursor rides along so the client can advance its
  # paging state without refetching.
  [[ "$(echo "$out" | visitor_field '@last_visited_at')" != 'null' ]] \
    || { echo "Expected a last_visited_at on the push"; echo "$out"; exit 1; }
}

# ---------------------------------------------------------------------------
# 3) Visiting yourself pushes nothing
# ---------------------------------------------------------------------------

self_visit_pushes_nothing () {
  q "delete from visited"

  chat_auth "$viewer_uuid" "$viewer_token"
  sleep 1
  drain

  visit_as "$viewer_token" "$viewer_uuid"
  sleep 2

  local out
  out=$(curl -sX GET http://localhost:3001/pop)
  assert_absent "$out" 'duo_visitor'
}

# ---------------------------------------------------------------------------
# 4) Visiting an *online* prospect pushes a live `visited_you` event to them
# ---------------------------------------------------------------------------

visited_you_pushed_to_online_prospect () {
  q "delete from visited"

  # The prospect is connected, so the chat server marks them online (and the
  # connection is subscribed to their own channel to receive pushes).
  chat_auth "$prospect_uuid" "$prospect_token"
  sleep 2 # Let the online batcher flush `last_online_time = now()`
  drain

  visit_as "$viewer_token" "$prospect_uuid"

  local out
  out=$(pop_until 'duo_visitor')

  assert_contains "$out" 'duo_visitor'

  [[ "$(echo "$out" | visitor_field '@section')" == 'visited_you' ]] \
    || { echo "Expected a visited_you push"; echo "$out"; exit 1; }

  # From the prospect's perspective the item describes their visitor (viewer).
  [[ "$(echo "$out" | visitor_field item .person_uuid | tr -d '"')" == "$viewer_uuid" ]] \
    || { echo "visited_you item should describe the viewer"; echo "$out"; exit 1; }
}

# ---------------------------------------------------------------------------
# 5) An *offline* prospect gets no `visited_you` push (the online gate)
# ---------------------------------------------------------------------------

no_visited_you_push_when_prospect_offline () {
  q "delete from visited"

  chat_auth "$prospect_uuid" "$prospect_token"
  sleep 2 # Let the initial online update flush...
  drain

  # ...then backdate it well past the online window. The chat connection only
  # refreshes `last_online_time` every few minutes, so this stays offline for
  # the duration of the visit below.
  q "
  update person
  set last_online_time = now() - interval '30 minutes'
  where id = ${prospect_id}"

  visit_as "$viewer_token" "$prospect_uuid"
  sleep 2

  local out
  out=$(curl -sX GET http://localhost:3001/pop)
  assert_absent "$out" 'duo_visitor'

  # The visit was still recorded, so the prospect will see it in their next
  # snapshot -- it just wasn't worth a live push while they were away.
  [[ "$(echo "$out" | grep -c duo_visitor || true)" -eq 0 ]]
  send_json '{ "duo_query_visitors": {} }'
  local snapshot
  snapshot=$(echo "$(pop_until 'duo_visitors')" | snapshot_payload)
  [[ "$(echo "$snapshot" | jq '.visited_you | length')" -eq 1 ]] \
    || { echo "Offline prospect should still accrue the visit"; exit 1; }
}

# ---------------------------------------------------------------------------
# 6) Browse Invisibly is respected by the live push
# ---------------------------------------------------------------------------

browse_invisibly_respected_by_push () {
  q "delete from visited"

  # The viewer turns on Browse Invisibly (a gold feature; create-user grants
  # gold). Their visits must stay hidden from the people they view.
  SESSION_TOKEN=$viewer_token
  jc PATCH /profile-info -d '{ "browse_invisibly": "Yes" }' > /dev/null

  # 6a) The online prospect must NOT be told they were visited.
  chat_auth "$prospect_uuid" "$prospect_token"
  sleep 2
  drain

  visit_as "$viewer_token" "$prospect_uuid"
  sleep 2

  local prospect_out
  prospect_out=$(curl -sX GET http://localhost:3001/pop)
  assert_absent "$prospect_out" 'visited_you'
  assert_absent "$prospect_out" 'duo_visitor'

  # 6b) ...but the invisible viewer still gets their own you_visited update, so
  # their "you visited" page keeps working.
  q "delete from visited"

  chat_auth "$viewer_uuid" "$viewer_token"
  sleep 1
  drain

  visit_as "$viewer_token" "$prospect_uuid"

  local viewer_out
  viewer_out=$(pop_until 'duo_visitor')
  assert_contains "$viewer_out" 'duo_visitor'
  [[ "$(echo "$viewer_out" | visitor_field '@section')" == 'you_visited' ]] \
    || { echo "Invisible viewer should still see their own you_visited"; echo "$viewer_out"; exit 1; }

  # Restore default so later cases aren't affected.
  SESSION_TOKEN=$viewer_token
  jc PATCH /profile-info -d '{ "browse_invisibly": "No" }' > /dev/null
}

# ---------------------------------------------------------------------------
# 7) `duo_mark_visitors_checked` acknowledges visitors over the websocket
# ---------------------------------------------------------------------------

mark_visitors_checked_over_websocket () {
  q "delete from visited"

  # Give the viewer a brand-new visitor and an old check time so it counts as
  # "new" until acknowledged.
  visit_as "$prospect_token" "$viewer_uuid"
  q "
  update person
  set last_visitor_check_time = now() - interval '1 day'
  where id = ${viewer_id}"

  chat_auth "$viewer_uuid" "$viewer_token"
  sleep 1
  drain

  # Acknowledge with no timestamp -> server clamps to now().
  send_json '{ "duo_mark_visitors_checked": {} }'
  sleep 2

  local checked_after
  checked_after=$(q "
    select extract(epoch from now() - last_visitor_check_time)::int
    from person where id = ${viewer_id}")
  [[ "$checked_after" -lt 60 ]] \
    || { echo "mark_visitors_checked stanza didn't advance the check time"; exit 1; }

  # A second, explicit timestamp in the past must NOT regress the check time
  # (the stanza honours `when` but the server keeps the latest).
  local old_time
  old_time=$(q "select iso8601_utc((now() - interval '2 days')::timestamp)")
  send_json '{ "duo_mark_visitors_checked": { "@when": "'"${old_time}"'" } }'
  sleep 2

  local checked_after_old
  checked_after_old=$(q "
    select extract(epoch from now() - last_visitor_check_time)::int
    from person where id = ${viewer_id}")
  [[ "$checked_after_old" -lt 60 ]] \
    || { echo "An older mark_visitors_checked should not regress the check time"; exit 1; }
}

snapshot_over_websocket
you_visited_pushed_to_viewer
self_visit_pushes_nothing
visited_you_pushed_to_online_prospect
no_visited_you_push_when_prospect_offline
browse_invisibly_respected_by_push
mark_visitors_checked_over_websocket
