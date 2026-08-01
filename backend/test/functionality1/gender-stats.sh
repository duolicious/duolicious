#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

q "delete from person"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0
../util/create-user.sh user3 0 0
../util/create-user.sh user4 0 0

q "update person set gender_id = 1 where name = 'user1'"
q "update person set gender_id = 2 where name = 'user2'"
q "update person set gender_id = 2 where name = 'user3'"
q "update person set gender_id = 3 where name = 'user4'"
set -xe

response=$(c GET /gender-stats)

[[ $(jq -r '.gender_ratio' <<< "$response") = '0.5' ]]
[[ $(jq -r '.non_binary_percentage' <<< "$response") = '25.0' ]]
