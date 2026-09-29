#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

q "delete from person"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0

q "update person set count_answers = 3 where name = 'user1'"
q "update person set count_answers = 4 where name = 'user2'"

set -xe

flush_redis

response=$(c GET /stats)

[[ $(jq -r '.num_sign_ups' <<< "$response") = $(q "select max(id) from person") ]]
[[ $(jq -r '.num_answers' <<< "$response") = 7 ]]
