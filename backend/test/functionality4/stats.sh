#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

q "delete from person"
q "delete from person_club"
q "delete from club"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0

assume_role user2
jc POST /join-club -d '{ "name": "my-club-1" }'
jc POST /join-club -d '{ "name": "my-club-2" }'

set -xe

q "update person set activated = false where name = 'user1'"

pending_count_deltas () {
  q "select count(*) from club_count_delta"
}
assert_eventually "0" pending_count_deltas

response=$(c GET '/stats')

[[ $(jq -r '.num_active_users' <<< "$response") = 1 ]]

response=$(c GET '/stats?club-name=my-club-1')

[[ $(jq -r '.num_active_users' <<< "$response") = 1 ]]

response=$(c GET '/stats?club-name=my-club-2')

[[ $(jq -r '.num_active_users' <<< "$response") = 1 ]]

response=$(c GET '/stats?club-name=my-club-3')

[[ $(jq -r '.num_active_users' <<< "$response") = 0 ]]
