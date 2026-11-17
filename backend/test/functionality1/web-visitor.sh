#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from duo_session"
q "delete from person"
q "delete from onboardee"
q "delete from web_visitor"
q "delete from experiment"

results () {
  q "select $1 from ($(cat ../../experiment-results.sql)) results where variant = '$2'"
}

response=$(jc POST /web-visitor -d '{}')
first_visitor=$(jq -r .web_visitor_id <<< "$response")
[[ "$(jq -c .variants <<< "$response")" = '{}' ]]
[[ "$(q "select ref is null and network is not null from web_visitor")" = t ]]

q "insert into experiment (name, variants) values ('headline', '{control,short}')"
q "insert into experiment (name, variants, ended_at) values ('old', '{control,long}', now())"

response=$(jc POST /web-visitor -d "{ \"web_visitor_id\": \"$first_visitor\" }")
[[ "$(jq -r .web_visitor_id <<< "$response")" = "$first_visitor" ]]
variant=$(jq -r .variants.headline <<< "$response")
[[ "$variant" = control || "$variant" = short ]]
[[ "$(jq -r '.variants | keys | join(",")' <<< "$response")" = headline ]]

for _ in 1 2 3
do
  response=$(jc POST /web-visitor -d "{ \"web_visitor_id\": \"$first_visitor\", \"ref\": \"reddit\" }")
  [[ "$(jq -r .variants.headline <<< "$response")" = "$variant" ]]
done
[[ "$(q "select count(*) from web_visitor")" -eq 1 ]]
[[ "$(q "select count(*) from web_visitor_variant")" -eq 1 ]]

unknown_visitor=$(q "select gen_random_uuid()")
response=$(jc POST /web-visitor -d "{ \"web_visitor_id\": \"$unknown_visitor\", \"ref\": \"reddit\" }")
second_visitor=$(jq -r .web_visitor_id <<< "$response")
[[ "$second_visitor" != "$unknown_visitor" ]]
[[ "$(q "select ref from web_visitor where id = '$second_visitor'")" = reddit ]]

! jc POST /web-visitor -d '{ "web_visitor_id": "not-a-uuid" }' || exit 1

for _ in $(seq 40)
do
  jc POST /web-visitor -d '{}' > /dev/null
done
[[ "$(q "select count(distinct variant) from web_visitor_variant")" -eq 2 ]]

response=$(jc POST /request-otp -d "{ \"email\": \"visitor@example.com\", \"web_visitor_id\": \"$first_visitor\" }")
SESSION_TOKEN=$(echo "$response" | jq -r '.session_token')
[[ "$(q "select web_visitor_id from duo_session")" = "$first_visitor" ]]

jc POST /check-otp -d '{ "otp": "000000" }'
jc PATCH /onboardee-info -d '{ "name": "Jeff" }'
jc PATCH /onboardee-info -d '{ "date_of_birth": "1997-05-30" }'
jc PATCH /onboardee-info -d '{ "location": "Sydney, New South Wales, Australia" }'
jc PATCH /onboardee-info -d '{ "gender": "Man" }'
jc PATCH /onboardee-info -d '{ "other_peoples_genders": ["Man", "Woman", "Other"] }'

[[ "$(q "select count(*) from web_visitor_sign_up")" -eq 0 ]]
c POST /finish-onboarding
[[ "$(q "select web_visitor_id from web_visitor_sign_up")" = "$first_visitor" ]]

[[ -z "$(results sign_ups "$variant")" ]]

q "update web_visitor_variant set assigned_at = assigned_at - interval '8 days'"
q "update web_visitor_sign_up set signed_up_at = signed_up_at - interval '8 days'"

[[ "$(results sign_ups "$variant")" -eq 1 ]]
[[ "$(q "select count(*) || ' ' || sum(visitors) from ($(cat ../../experiment-results.sql)) results")" = "2 42" ]]

q "delete from person"
[[ "$(results sign_ups "$variant")" -eq 1 ]]

response=$(jc POST /request-otp -d '{ "email": "visitor2@example.com", "web_visitor_id": "'"$unknown_visitor"'" }')
[[ "$(q "select count(*) from duo_session where web_visitor_id = '$unknown_visitor'")" -eq 1 ]]
