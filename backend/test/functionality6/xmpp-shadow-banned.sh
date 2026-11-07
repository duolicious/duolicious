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

../util/create-user.sh user1 0 0   # shadow-banned sender
../util/create-user.sh user2 0 0   # recipient
../util/create-user.sh user3 0 0   # normal sender (control)

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

# Authenticate as the sender, send one message, then return whatever the
# sender's own connection received back (e.g. the delivery receipt).
send_message_and_pop () {
  curl -sX GET http://localhost:3001/pop > /dev/null
  send_message "$@" > /dev/null
  sleep 3

  curl -sX GET http://localhost:3001/pop
}


echo "A shadow-banned sender's message is stored only on their own side"

q "update person set shadow_banned_at = now() where name = 'user1'"

receipt=$(send_message_and_pop "$user1uuid" "$user1token" "$user2uuid" "hello from a shadow-banned user")

# The sender still gets a delivery receipt, so their app behaves normally
echo "$receipt" | grep -q duo_message_delivered \
  || { echo "Expected the shadow-banned sender to get a delivery receipt"; exit 1; }

# The sender's own archive keeps the outgoing copy
[[ "$(q "select count(*) from mam_message where person_id = ${user1id}")" -ge 1 ]] \
  || { echo "Expected the sender's archive to keep the message"; exit 1; }

# The recipient's archive never receives a copy
[[ "$(q "select count(*) from mam_message where person_id = ${user2id}")" -eq 0 ]] \
  || { echo "Expected the recipient's archive to stay empty"; exit 1; }

# The sender's chats list shows the conversation
[[ "$(q "select count(*) from inbox where luser like '${user1uuid}%'")" -ge 1 ]] \
  || { echo "Expected the sender to have an inbox row"; exit 1; }

# The recipient's inbox never gains an entry (so the notification cron, which
# reads `inbox`, never fires for it either)
[[ "$(q "select count(*) from inbox where luser like '${user2uuid}%'")" -eq 0 ]] \
  || { echo "Expected the recipient to have no inbox row"; exit 1; }


echo "A non-banned sender's message reaches the recipient (control)"

receipt=$(send_message_and_pop "$user3uuid" "$user3token" "$user2uuid" "hello from a normal user")

echo "$receipt" | grep -q duo_message_delivered \
  || { echo "Expected the normal sender to get a delivery receipt"; exit 1; }

# Both archives now hold a copy
[[ "$(q "select count(*) from mam_message where person_id = ${user3id}")" -ge 1 ]] \
  || { echo "Expected the sender's archive to keep the message"; exit 1; }

[[ "$(q "select count(*) from mam_message where person_id = ${user2id}")" -ge 1 ]] \
  || { echo "Expected the recipient's archive to receive the message"; exit 1; }

# The recipient now has an inbox entry
[[ "$(q "select count(*) from inbox where luser like '${user2uuid}%'")" -ge 1 ]] \
  || { echo "Expected the recipient to have an inbox row"; exit 1; }
