#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from duo_session"
q "delete from person"
q "delete from onboardee"
q "delete from experiment_exposure"
q "delete from web_visitor_sign_up"

visitor=$(q "select gen_random_uuid()")

exposure () {
  jc POST /experiment-exposure -d "{
    \"web_visitor_id\": \"$1\",
    \"experiment\": \"$2\",
    \"variant\": \"$3\"
  }"
}

exposure "$visitor" hero-copy short-headline
exposure "$visitor" hero-copy short-headline
exposure "$visitor" cta control
[[ "$(q "select string_agg(experiment || ' ' || variant, ',' order by experiment) from experiment_exposure")" = "cta control,hero-copy short-headline" ]]
[[ "$(q "select count(*) from experiment_exposure where ip_address is null")" -eq 0 ]]

! exposure not-a-uuid hero-copy control || exit 1
! exposure "$visitor" 'Hero Copy' control || exit 1
! exposure "$visitor" hero-copy '' || exit 1
! jc POST /experiment-exposure -d '{}' || exit 1

response=$(jc POST /request-otp -d '{ "email": "visitor@example.com" }')
SESSION_TOKEN=$(echo "$response" | jq -r '.session_token')

jc POST /check-otp -d '{ "otp": "000000" }'
jc PATCH /onboardee-info -d '{ "name": "Jeff" }'
jc PATCH /onboardee-info -d '{ "date_of_birth": "1997-05-30" }'
jc PATCH /onboardee-info -d '{ "location": "Sydney, New South Wales, Australia" }'
jc PATCH /onboardee-info -d '{ "gender": "Man" }'
jc PATCH /onboardee-info -d '{ "other_peoples_genders": ["Man", "Woman", "Other"] }'

! jc POST /finish-onboarding -d '{ "web_visitor_id": "not-a-uuid" }' || exit 1
[[ "$(q "select count(*) from person")" -eq 0 ]]
jc POST /finish-onboarding -d "{ \"web_visitor_id\": \"$visitor\" }"
[[ "$(q "select web_visitor_id from web_visitor_sign_up")" = "$visitor" ]]

q "delete from person"
[[ "$(q "select web_visitor_id from web_visitor_sign_up")" = "$visitor" ]]
