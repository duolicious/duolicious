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

q "update person set intros_notification = 1"

assume_role user1 ; user1token=$SESSION_TOKEN
assume_role user2 ; user2token=$SESSION_TOKEN
assume_role user3 ; user3token=$SESSION_TOKEN

user1uuid=$(get_uuid 'user1@example.com')
user2uuid=$(get_uuid 'user2@example.com')
user3uuid=$(get_uuid 'user3@example.com')

user1id=$(get_id 'user1@example.com')
user2id=$(get_id 'user2@example.com')
user3id=$(get_id 'user3@example.com')

# Assert that at least one popped stanza satisfies the jq boolean expression,
# where each stanza is bound to `.`. Reads the popped output from stdin.
assert_any () {
  jq -se "any(.[]; $1)" > /dev/null
}

# Authenticate as the sender then deliver a chat message over the JSON
# subprotocol. Equivalent to the XML:
#   <message type='chat' from='…' to='…' id='…' xmlns='jabber:client'>
#     <body>…</body><request xmlns='urn:xmpp:receipts'/>
#   </message>
send_message () {
  local fromUuid=$1
  local fromToken=$2
  local toUuid=$3
  local message=$4
  local id=${5:-id1}

  chat_auth "$fromUuid" "$fromToken"

  sleep 1

  read -r -d '' payload <<EOF || true
{
  "message": {
    "@type": "chat",
    "@from": "${fromUuid}@duolicious.app",
    "@to": "${toUuid}@duolicious.app",
    "@id": "${id}",
    "@xmlns": "jabber:client",
    "body": "${message}",
    "request": {
      "@xmlns": "urn:xmpp:receipts"
    }
  }
}
EOF

  curl -X POST http://localhost:3001/send -H "Content-Type: application/json" -d "$payload"
}

# Register (or, with an empty token, clear) a push token for the authenticated
# session. Equivalent to <duo_register_push_token token='…'/>.
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
}

# Report user2 so we can test that banning them deletes their messages
jc POST "/skip/by-uuid/${user2uuid}" -d '{ "report_reason": "smells bad" }'
ban_token=$(
  q "select token from banned_person_admin_token where person_id = $user2id")



echo '`last_online_time` is updated upon logging in'
q "update person set last_online_time = to_timestamp(0)"


sleep 3

chat_auth "$user1uuid" "$user1token"

sleep 3

[[ "$(q "select count(*) from person where last_online_time <> to_timestamp(0) and uuid = '$user1uuid'")" = 1 ]]



echo 'Ping results in pong'

chat_auth "$user1uuid" "$user1token"

sleep 1

curl -X POST http://localhost:3001/send -H "Content-Type: application/json" -d '{ "duo_ping": null }'

sleep 0.5

curl -sX GET http://localhost:3001/pop \
  | assert_any 'has("duo_pong")
      and (.duo_pong["@preferred_interval"] | test("^[0-9]+$"))
      and (.duo_pong["@preferred_timeout"] | test("^[0-9]+$"))'



echo If user 2 blocks user 1 then user 1 can no longer message user 2

q "insert into skipped values ($user2id, $user1id, false, 'testing blocking')"

send_message "$user1uuid" "$user1token" "$user2uuid" "hello user 2"

sleep 3 # MongooseIM takes some time to flush messages to the DB

[[ "$(q "select count(*) from messaged where \
    subject_person_id = $user1id and \
    object_person_id = $user2id")" = 0 ]]
[[ "$(q "select count(*) from messaged")" = 0 ]]

curl -sX GET http://localhost:3001/pop \
  | assert_any 'has("duo_message_blocked")
      and .duo_message_blocked["@id"] == "id1"
      and (.duo_message_blocked["@reason"] == null)'

[[ "$(q "select count(*) from mam_message where \
    body like '%hello user 2%'")" = 0 ]]

q "delete from skipped where subject_person_id = $user2id and object_person_id = $user1id"

sleep 5  # Wait for ttl cache to expire



echo User 1 can message user 2

send_message "$user1uuid" "$user1token" "$user2uuid" "hello user 2"

sleep 4 # MongooseIM takes some time to flush messages to the DB

[[ "$(q "select count(*) from messaged where \
    subject_person_id = $user1id and \
    object_person_id = $user2id")" = 1 ]]

[[ "$(q "select count(*) from messaged")" = 1 ]]

curl -sX GET http://localhost:3001/pop \
  | assert_any 'has("duo_message_delivered") and .duo_message_delivered["@id"] == "id1"'

[[ "$(q "select count(*) from mam_message where \
    body like '%hello user 2%'")" = 2 ]]

[[ "$(q "select count(*) from inbox where \
    luser = '${user1uuid}' and \
    remote_bare_jid = '${user2uuid}@duolicious.app' and \
    box = 'chats'")" = 1 ]]

[[ "$(q "select count(*) from inbox where \
    luser = '${user2uuid}' and \
    remote_bare_jid = '${user1uuid}@duolicious.app' and \
    box = 'inbox'")" = 1 ]]



echo "A second message without a reply stays in user 2's intros"

send_message "$user1uuid" "$user1token" "$user2uuid" "hello once more" "id1b"

sleep 4 # MongooseIM takes some time to flush messages to the DB

curl -sX GET http://localhost:3001/pop \
  | assert_any 'has("duo_message_delivered") and .duo_message_delivered["@id"] == "id1b"'

[[ "$(q "select count(*) from inbox where \
    luser = '${user1uuid}' and \
    remote_bare_jid = '${user2uuid}@duolicious.app' and \
    box = 'chats'")" = 1 ]]

[[ "$(q "select count(*) from inbox where \
    luser = '${user2uuid}' and \
    remote_bare_jid = '${user1uuid}@duolicious.app' and \
    box = 'inbox' and \
    unread_count = 2")" = 1 ]]



echo The push token user-x-token should be acknowledged and inserted into the database

register_push_token "$user1uuid" "$user1token" 'user-x-token'

sleep 1.5

curl -sX GET http://localhost:3001/pop | assert_any 'has("duo_registration_successful")'
[[ "$(q "select count(*) from duo_session ds \
    join person p on p.id = ds.person_id \
    where p.uuid::text = '$user1uuid' \
    and ds.push_token = 'user-x-token'")" = 1 ]]



echo The push token should be acknowledged and deleted from the database

register_push_token "$user1uuid" "$user1token" ''

sleep 1.5

curl -sX GET http://localhost:3001/pop | assert_any 'has("duo_registration_successful")'
[[ "$(q "select count(*) from duo_session ds \
    join person p on p.id = ds.person_id \
    where p.uuid::text = '$user1uuid' \
    and ds.push_token = 'user-x-token'")" = 0 ]]



echo The push token user-1-token should be acknowledged and inserted into the database

register_push_token "$user1uuid" "$user1token" 'user-1-token'

sleep 0.5

curl -sX GET http://localhost:3001/pop | assert_any 'has("duo_registration_successful")'
[[ "$(q "select count(*) from duo_session ds \
    join person p on p.id = ds.person_id \
    where p.uuid::text = '$user1uuid' \
    and ds.push_token = 'user-1-token'")" = 1 ]]



echo Unoriginal intros are rejected

send_message "$user1uuid" "$user1token" "$user3uuid" "hello user 2" "id2"

sleep 3 # MongooseIM takes some time to flush messages to the DB

curl -sX GET http://localhost:3001/pop \
  | assert_any 'has("duo_message_not_unique")
      and .duo_message_not_unique["@id"] == "id2"
      and .duo_message_not_unique["@used_count"] == "1"'

[[ "$(q "select count(*) from mam_message where \
    body like '%hello user 2%'")" = 2 ]]

[[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]



echo 'User 1 can message user 3 and notification is sent'

# Mark the token'd session as the most recently used one. Each `assume_role`
# above also leaves a signed-in, push-less (web) session; without this bump the
# web session could be more recent, in which case the live push correctly defers
# to the cron and no immediate notification is recorded.
q "update duo_session set push_token = 'user-2-token', last_online_time = now()
    where session_token_hash = (
    select ds.session_token_hash from duo_session ds
    join person p on p.id = ds.person_id
    where p.uuid::text = '$user2uuid' and ds.signed_in limit 1)"
q "update duo_session set push_token = 'user-3-token', last_online_time = now()
    where session_token_hash = (
    select ds.session_token_hash from duo_session ds
    join person p on p.id = ds.person_id
    where p.uuid::text = '$user3uuid' and ds.signed_in limit 1)"

send_message "$user1uuid" "$user1token" "$user3uuid" "hello user 3" "id3"

sleep 3 # MongooseIM takes some time to flush messages to the DB

[[ "$(q "select count(*) from messaged where \
    subject_person_id = $user1id and \
    object_person_id = $user3id")" = 1 ]]

[[ "$(q "select count(*) from messaged")" = 2 ]]

curl -sX GET http://localhost:3001/pop \
  | assert_any 'has("duo_message_delivered") and .duo_message_delivered["@id"] == "id3"'

[[ "$(q "select count(*) from mam_message where \
    body like '%hello user 3%'")" = 2 ]]

[[ "$(q " \
  select count(*) \
  from person \
  where \
  uuid::text = '$user3uuid' and \
  chat_seconds = 0 and \
  intro_seconds > 0")" = 1 ]]



echo "User 3 can send user 1 an unoriginal message now that they're chatting"

send_message "$user3uuid" "$user3token" "$user1uuid" "hello user 2" "id3"

sleep 3 # MongooseIM takes some time to flush messages to the DB

curl -sX GET http://localhost:3001/pop \
  | assert_any 'has("duo_message_delivered") and .duo_message_delivered["@id"] == "id3"'

[[ "$(q "select count(*) from mam_message where \
    body like '%hello user 2%'")" = 4 ]]

[[ "$(q "select count(*) from inbox where \
    luser = '${user3uuid}' and \
    remote_bare_jid = '${user1uuid}@duolicious.app' and \
    box = 'chats'")" = 1 ]]

[[ "$(q " \
  select count(*) \
  from person \
  where \
  uuid::text = '$user3uuid' and \
  chat_seconds = 0 and \
  intro_seconds > 0")" = 1 ]]

[[ "$(q " \
  select count(*) \
  from person \
  where \
  uuid::text = '$user1uuid' and \
  chat_seconds > 0 and \
  intro_seconds = 0")" = 1 ]]



echo "User 1 can stop getting immediate notifications by updating their preferences"

q "update person set chats_notification = 2 where id = $user1id"
sleep 10 # Wait for ttl cache to expire

q "update person set intro_seconds = 0, chat_seconds = 0"

send_message "$user3uuid" "$user3token" "$user1uuid" "message will be sent with no notification" "id3"

sleep 3 # MongooseIM takes some time to flush messages to the DB

curl -sX GET http://localhost:3001/pop \
  | assert_any 'has("duo_message_delivered") and .duo_message_delivered["@id"] == "id3"'

[[ "$(q "select count(*) from mam_message where \
    body like '%message will be sent with no notification%'")" = 2 ]]

[[ "$(q "select count(*) from person where intro_seconds > 0 or chat_seconds > 0")" = 0 ]]



echo a pre-OTP session must not be authorized to chat as the target account

# Request an OTP for user3 but never verify it. The resulting session is bound
# to user3's account yet still has signed_in = FALSE, mimicking an attacker who
# knows only the victim's email and public UUID.
preotp_token=$(
  jc POST /request-otp -d '{ "email": "user3@example.com" }' \
    | jq -r '.session_token'
)

[[ "$(q "select signed_in from duo_session where email = 'user3@example.com' order by otp_expiry desc limit 1")" = f ]]

chat_auth "$user3uuid" "$preotp_token"

sleep 1

curl -sX GET http://localhost:3001/pop \
  | assert_any 'has("failure")
      and .failure["@xmlns"] == "urn:ietf:params:xml:ns:xmpp-sasl"
      and (.failure | has("not-authorized"))'



echo user 1 should no longer be authorized to chat after deleting their account

assume_role user1

c DELETE /account

chat_auth "$user1uuid" "$user1token"

sleep 1

curl -sX GET http://localhost:3001/pop \
  | assert_any 'has("failure")
      and .failure["@xmlns"] == "urn:ietf:params:xml:ns:xmpp-sasl"
      and (.failure | has("not-authorized"))'

chat_auth "$user2uuid" "$user2token"

sleep 1



echo user2 can still see user1\'s message after user1 deletes their account

read -r -d '' inbox_query <<EOF || true
{
  "iq": {
    "@type": "set",
    "@id": "id3",
    "inbox": {
      "@xmlns": "erlang-solutions.com:xmpp:inbox:0",
      "@queryid": "id3"
    }
  }
}
EOF

curl -X POST http://localhost:3001/send -H "Content-Type: application/json" -d "$inbox_query"

sleep 0.5

curl -sX GET http://localhost:3001/pop | grep -qF '"body": "hello once more"'



echo user1\'s records are no longer on the server

[[ "$(q "select count(*) from inbox where luser = '$user1uuid'")" = 0 ]]
[[ "$(q "select count(*) from person where uuid::text = '$user1uuid' and (intro_seconds > 0 or chat_seconds > 0)")" = 0 ]]
[[ "$(q "select count(*) from duo_session where push_token = 'user-1-token'")" = 0 ]]



echo 'Banning user2 deletes them from the XMPP server (but not accessing the ban link)'

c GET "/admin/ban-link/${ban_token}"

[[ "$(q "select count(*) from inbox where luser = '$user2uuid'")" = 1 ]]
[[ "$(q "select count(*) from person where uuid::text = '$user2uuid' and (intro_seconds > 0 or chat_seconds > 0)")" = 0 ]]
[[ "$(q "select count(*) from duo_session where push_token = 'user-2-token'")" = 1 ]]

c GET "/admin/ban/${ban_token}"

[[ "$(q "select count(*) from inbox where luser = '$user2uuid'")" = 0 ]]
[[ "$(q "select count(*) from person where uuid::text = '$user2uuid' and (intro_seconds > 0 or chat_seconds > 0)")" = 0 ]]
[[ "$(q "select count(*) from duo_session where push_token = 'user-2-token'")" = 0 ]]
