#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

q "delete from person"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0
../util/create-user.sh user3 0 0
../util/create-user.sh user4 0 0

q "update person set date_of_birth = current_date - interval '19 years 6 months' where name = 'user1'"
q "update person set date_of_birth = current_date - interval '21 years 6 months' where name = 'user2'"
q "update person set date_of_birth = current_date - interval '31 years 6 months' where name = 'user3'"
q "update person set date_of_birth = current_date - interval '34 years 6 months' where name = 'user4'"

set -xe

flush_redis

response=$(c GET /stats)

[[ $(jq -r '.median_age' <<< "$response") = 26 ]]
[[ $(jq -c '.age_buckets | map([.label, .count])' <<< "$response") = '[["18-19",1],["20-21",1],["22-23",0],["24-25",0],["26-27",0],["28-29",0],["30-31",1],["32-33",0],["34+",1]]' ]]
