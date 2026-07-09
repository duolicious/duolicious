#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

date_in_20_days=$(q "select iso8601_utc((now() + interval '20 days')::timestamp)")

q "delete from duo_session"
q "delete from person"
q "delete from onboardee"
q "delete from undeleted_photo"
q "update question set count_yes = 0, count_no = 0"
q "update funding set estimated_end_date = '$date_in_20_days'"

response=$(jc POST /request-otp -d '{ "email": "MAIL@example.com" }')

SESSION_TOKEN=$(echo "$response" | jq -r '.session_token')

otp_expiry1=$(q "SELECT otp_expiry FROM duo_session order by otp_expiry desc limit 1")
[[ -n "$otp_expiry1" ]]

c POST /resend-otp

otp_expiry2=$(q "SELECT otp_expiry FROM duo_session order by otp_expiry desc limit 1")
[[ -n "$otp_expiry2" ]]

[[ "$otp_expiry1" != "$otp_expiry2" ]]

! jc POST /check-otp -d '{ "otp": "000001" }' || exit 1

[[ "$(q "select COUNT(*) from onboardee")" -eq 0 ]]

jc POST /check-otp -d '{ "otp": "000000" }'

[[ "$(q "select COUNT(*) from onboardee")" -eq 1 ]]

jc PATCH /onboardee-info -d '{ "name": "Jeff" }'
jc PATCH /onboardee-info -d '{ "date_of_birth": "1997-05-30" }'
c GET /search-locations?q=Syd
jc PATCH /onboardee-info -d '{ "location": "Sydney, New South Wales, Australia" }'
jc PATCH /onboardee-info -d '{ "gender": "Man" }'
jc PATCH /onboardee-info -d '{ "other_peoples_genders": ["Man", "Woman", "Other"] }'

! jc PATCH /onboardee-info \
  -d "{
          \"base64_file\": {
              \"position\": 1,
              \"base64\": \"$(rand_image)\",
              \"top\": 0,
              \"left\": 0
          }
      }" || exit 1

[[ "$(q "select count(*) from duo_session where person_id is null")" -eq 1 ]]

! c GET /next-questions || exit 1
response=$(c POST /finish-onboarding)
[[ "$(jq -r .units <<< "$response")" = Metric ]]
[[ "$(jq -r .do_show_donation_nag <<< "$response")" = false ]]
[[ "$(jq -r .name <<< "$response")" = Jeff ]]
[[ "$(jq -r '.estimated_end_date' <<< "$response")" = "$date_in_20_days" ]]

[[ "$(q "select count(*) from duo_session where person_id is null")" -eq 0 ]]

c GET /next-questions > /dev/null
! c POST /finish-onboarding || exit 1

# Test signing out works
c POST /sign-out
! c POST /check-session-token || exit 1

# Can we sign back in?

response=$(jc POST /request-otp -d '{ "email": "mail@example.com" }')
SESSION_TOKEN=$(echo "$response" | jq -r '.session_token')

! c POST /check-session-token || exit 1

! jc POST /check-otp -d '{ "otp": "000001" }' || exit 1

response=$(
  jc POST /check-otp -d '{ "otp": "000000" }'
)

[[ "$(echo "$response" | jq -r '.onboarded')" = true ]]
[[ "$(echo "$response" | jq -r '.units')"     = Metric ]]

response=$(c POST /check-session-token)
[[ "$(echo "$response" | jq -r '.units')" = Metric ]]

c GET /search-locations?q=Syd

jc POST /answer -d '{ "question_id": 1001, "answer": true, "public": false }'
jc POST /answer -d '{ "question_id": 1002, "answer": false, "public": false }'

# The yes/no counts land via a one-second batcher, not in the POST /answer
# transaction
sleep 2

[[ "$(q "select count_yes   from question where id = 1001")" -eq 1 ]]
[[ "$(q "select count_no    from question where id = 1001")" -eq 0 ]]
[[ "$(q "select count_yes   from question where id = 1002")" -eq 0 ]]
[[ "$(q "select count_no    from question where id = 1002")" -eq 1 ]]
