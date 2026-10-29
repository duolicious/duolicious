#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from person"
q "delete from duo_session"
q "delete from mam_message"
q "delete from inbox"
q "delete from intro_hash"
delete_emails

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0
../util/create-user.sh reporterbot 0 0

q "update person set roles = '{\"bot\"}' where name = 'reporterbot'"

assume_role user1 ; user1token=$SESSION_TOKEN
assume_role user2 ; user2token=$SESSION_TOKEN

user1uuid=$(get_uuid 'user1@example.com')
user2uuid=$(get_uuid 'user2@example.com')

send_message () {
  local fromUuid=$1
  local fromToken=$2
  local toUuid=$3
  local message=$4

  chat_auth "$fromUuid" "$fromToken"

  sleep 1

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

  curl -X POST http://localhost:3001/send -H "Content-Type: application/json" -d "$payload"
}

count_reports () {
  get_emails | grep -c -F 'Report:' || true
}

send_message "$user2uuid" "$user2token" "$user1uuid" 'how old are you?'
send_message "$user1uuid" "$user1token" "$user2uuid" 'im 15 lol, i lied about my age'

assert_eventually 1 count_reports

get_emails | grep -F 'Report:' | grep -F '[underage - chat model]'
get_emails | grep -qxF 'Automatically lodged report: Child safety (chat)'
get_emails | grep -qxF -- '- other person: how old are you?'
get_emails | grep -qxF -- '- accused (flagged message): im 15 lol, i lied about my age'

[[ "$(q "select verification_required from person where name = 'user1'")" == f ]]

echo 'A member who was already reported is reported again'

send_message "$user1uuid" "$user1token" "$user2uuid" 'honestly im 15'

assert_eventually 2 count_reports
