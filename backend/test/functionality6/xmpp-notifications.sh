#!/usr/bin/env bash

# Purpose: Push tokens live per-session on `duo_session`. Verify that:
#   1. Registering/clearing a push token writes to the current session.
#   2. The live (immediate) push path defers to the cron when the user's most
#      recent session is a web client, so the cron's web-client email isn't
#      suppressed by an upserted last-notification time.

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

# Send a <duo_register_push_token token='…'/> for the authenticated session. An
# empty token clears it.
register_push_token () {
  local fromUuid=$1
  local fromToken=$2
  local token=$3

  chat_auth "$fromUuid" "$fromToken"

  sleep 1

  if [[ -n "$token" ]]; then
    read -r -d '' payload <<EOF || true
{ "duo_register_push_token": { "@token": "${token}" } }
EOF
  else
    read -r -d '' payload <<EOF || true
{ "duo_register_push_token": {} }
EOF
  fi

  curl -X POST http://localhost:3001/send -H "Content-Type: application/json" -d "$payload"
  sleep 1.5
}

count_push_token () {
  local uuid=$1
  local token=$2

  q "select count(*) from duo_session ds
     join person p on p.id = ds.person_id
     where p.uuid::text = '${uuid}' and ds.push_token = '${token}'"
}



echo 'A push token is registered against the current session'

../util/create-user.sh user1 0 0
assume_role user1 ; user1token=$SESSION_TOKEN
user1uuid=$(get_uuid 'user1@example.com')

register_push_token "$user1uuid" "$user1token" 'user-x-token'
[[ "$(count_push_token "$user1uuid" 'user-x-token')" = 1 ]]



echo 'An empty registration clears the token from that session'

register_push_token "$user1uuid" "$user1token" ''
[[ "$(count_push_token "$user1uuid" 'user-x-token')" = 0 ]]



echo 'Immediate push defers to the cron when the latest session is a web client'

# `assume_role` above exported a SESSION_TOKEN that `create-user.sh` would
# inherit and send as a Bearer token. Clear it so create-user authenticates from
# scratch rather than reusing user1's session.
unset SESSION_TOKEN

# Fresh users: the push-token lookup is cached for 2 minutes per recipient, so
# reusing an earlier user would read a stale (pre-web-session) result.
../util/create-user.sh weba 0 0
../util/create-user.sh webb 0 0
../util/create-user.sh webc 0 0

q "update person
   set intros_notification = 1, chats_notification = 1,
       intro_seconds = 0, chat_seconds = 0
   where email in ('weba@example.com', 'webb@example.com', 'webc@example.com')"

assume_role weba ; webatoken=$SESSION_TOKEN
webauuid=$(get_uuid 'weba@example.com')
webbuuid=$(get_uuid 'webb@example.com')
webcuuid=$(get_uuid 'webc@example.com')
webaid=$(get_id 'weba@example.com')
webbid=$(get_id 'webb@example.com')
webcid=$(get_id 'webc@example.com')

# webb: mobile session (older) + web session (newer) -> web is most recent, so
# the live push must defer to the cron (which emails web users) rather than
# pushing and upserting the last-notification time, which would suppress it.
# webb is not `assume_role`'d, so its only other session is create-user's.
q "update duo_session
   set push_token = 'webb-mobile-token',
       last_online_time = now() - interval '20 minutes'
   where signed_in
   and person_id = (select id from person where uuid::text = '$webbuuid')"
q "insert into duo_session
     (session_token_hash, person_id, email, signed_in, last_online_time)
   select 'web-session-webb', p.id, p.email, true, now() - interval '1 minute'
   from person p where p.uuid::text = '$webbuuid'"

# webc: web session (older) + mobile session (newer) -> mobile is most recent,
# so the live push fires as usual.
q "update duo_session
   set push_token = 'webc-mobile-token',
       last_online_time = now() - interval '1 minute'
   where signed_in
   and person_id = (select id from person where uuid::text = '$webcuuid')"
q "insert into duo_session
     (session_token_hash, person_id, email, signed_in, last_online_time)
   select 'web-session-webc', p.id, p.email, true, now() - interval '20 minutes'
   from person p where p.uuid::text = '$webcuuid'"

clear_pushes

send_message "$webauuid" "$webatoken" "$webbuuid" "hello webb" "id-web"
sleep 1
send_message "$webauuid" "$webatoken" "$webcuuid" "hello webc" "id-mobile"
sleep 1

sleep 3 # MongooseIM takes some time to flush messages to the DB

# Both intros were delivered and stored ...
[[ "$(q "select count(*) from messaged where subject_person_id = $webaid and object_person_id = $webbid")" = 1 ]]
[[ "$(q "select count(*) from messaged where subject_person_id = $webaid and object_person_id = $webcid")" = 1 ]]

# ... but only webc (mobile most recent) got an immediate push, delivered to its
# token. webb (web most recent) was deferred to the cron, so its
# last-notification time is untouched and no push was sent.
[[ "$(q "select count(*) from person where uuid::text = '$webbuuid' and (intro_seconds > 0 or chat_seconds > 0)")" = 0 ]]
[[ "$(q "select count(*) from person where uuid::text = '$webcuuid' and intro_seconds > 0")" = 1 ]]
[[ "$(count_pushes_to 'webc-mobile-token')" = 1 ]]
[[ "$(count_pushes_to 'webb-mobile-token')" = 0 ]]



echo 'A registered mobile device receives a real-time push notification'

unset SESSION_TOKEN
../util/create-user.sh sendr 0 0
../util/create-user.sh recvr 0 0

q "update person set intros_notification = 1, intro_seconds = 0
   where email in ('sendr@example.com', 'recvr@example.com')"

assume_role recvr ; recvrtoken=$SESSION_TOKEN
recvruuid=$(get_uuid 'recvr@example.com')
recvrid=$(get_id 'recvr@example.com')

# recvr registers a push token over the chat connection, then we make that
# session the most recent so the live push targets it.
register_push_token "$recvruuid" "$recvrtoken" 'recvr-token'
q "update duo_session set last_online_time = now() where push_token = 'recvr-token'"

assume_role sendr ; sendrtoken=$SESSION_TOKEN
sendruuid=$(get_uuid 'sendr@example.com')
sendrid=$(get_id 'sendr@example.com')

clear_pushes

send_message "$sendruuid" "$sendrtoken" "$recvruuid" "hello recvr" "id-happy"
sleep 1

sleep 3

[[ "$(q "select count(*) from messaged where subject_person_id = $sendrid and object_person_id = $recvrid")" = 1 ]]
[[ "$(q "select count(*) from person where uuid::text = '$recvruuid' and intro_seconds > 0")" = 1 ]]
[[ "$(count_pushes_to 'recvr-token')" = 1 ]]
