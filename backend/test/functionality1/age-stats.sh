#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

q "delete from person"

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0
../util/create-user.sh user3 0 0
../util/create-user.sh user4 0 0

q "update person set date_of_birth = current_date - interval '20 years 6 months' where name = 'user1'"
q "update person set date_of_birth = current_date - interval '30 years 6 months' where name = 'user2'"
q "update person set date_of_birth = current_date - interval '40 years 6 months' where name = 'user3'"
q "update person set date_of_birth = current_date - interval '60 years 6 months' where name = 'user4'"

set -xe

flush_redis

response=$(c GET /stats)

[[ $(jq -r '.median_age' <<< "$response") = 35 ]]
[[ $(jq -c '.age_buckets | map([.label, .count])' <<< "$response") = '[["18-24",1],["25-34",1],["35-44",1],["45-54",0],["55+",1]]' ]]
