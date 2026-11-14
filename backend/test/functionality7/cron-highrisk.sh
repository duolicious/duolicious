#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -ex

q "delete from person"

../util/create-user.sh user1 0 1
../util/create-user.sh user2 0 1
../util/create-user.sh reporterbot 0 0

q "update person set roles = '{\"bot\", \"mod\"}' where name = 'reporterbot'"
q "update person set gender_id = 2 where name in ('user1', 'user2')"
q "update person set sign_up_time = now() - interval '2 hours' where name = 'user1'"
q "update person set sign_up_time = now() - interval '1 day' where name = 'user2'"

scored () {
  [[ "$(q "
    select count(*)
    from high_risk_score
    join person on person.id = high_risk_score.person_id
    where name = 'user1' and hours = 1 and score between 0 and 1
  ")" = 1 ]]
}

for _ in $(seq 60)
do
  scored && break
  sleep 1
done

scored

[[ "$(q "select count(*) from high_risk_score")" = 1 ]]
[[ "$(q "select required_verification_level_id from person where name = 'user1'")" = 1 ]]
