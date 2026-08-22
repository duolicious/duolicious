#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from duo_session"
q "delete from person"
q "delete from person_club"
q "delete from club"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0

assume_role user1
jc POST /join-club -d '{ "name": "my-club-shared-1" }'
jc POST /join-club -d '{ "name": "my-club-shared-2" }'
jc POST /join-club -d '{ "name": "my-club-unshared-10" }'
jc POST /join-club -d '{ "name": "my-club-unshared-20" }'

assume_role user2
jc POST /join-club -d '{ "name": "my-club-shared-1" }'
jc POST /join-club -d '{ "name": "my-club-shared-2" }'
jc POST /join-club -d '{ "name": "my-club-unshared-11" }'
jc POST /join-club -d '{ "name": "my-club-unshared-21" }'

assume_role user1
expected=$(
  jq -r . <<< "[ \
    {\"count_members\": 1, \"name\": \"my-club-unshared-11\"}, \
    {\"count_members\": 1, \"name\": \"my-club-unshared-21\"}, \
    {\"count_members\": 0, \"name\": \"my-club\"} \
  ]"
)
assert_eventually "$expected" c GET '/search-clubs?q=my-club'

results=$(c GET '/search-clubs?q=really-long-club-name-that-exceeds-the-limit')
expected='[]'
[[ "$results" == "$expected" ]]
