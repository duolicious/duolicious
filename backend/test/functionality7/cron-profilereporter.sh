#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -ex

q "delete from person"
q "delete from unmoderated_person"
delete_emails

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0
../util/create-user.sh reporterbot 0 0

q "update person set roles = '{\"bot\"}' where name = 'reporterbot'"

assume_role user1
jc PATCH /profile-info -d '{ "about": "18. just looking for friends" }'

assume_role user2
jc PATCH /profile-info -d '{ "about": "17. just looking for friends" }'

_get_emails() {
  get_emails \
    | grep -vF 'Report:' \
    | grep -vF 'id:' \
    | grep -vF 'uuid:' \
    | grep -vF 'token:' \
    | grep -vF '/admin/ban-link/'
}

# A report should only take a second to be sent, though we wait some extra time
# to test that the reporting system doesn't send duplicates
sleep 3

diff -u --color \
  <(_get_emails) \
  ../../test/fixtures/cron-emails-profilereporter
