#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

q "delete from duo_session"
q "delete from person"
q "delete from onboardee"
q "delete from undeleted_photo"
q "update question set count_yes = 0, count_no = 0"

response=$(
  jc \
    POST \
    /request-otp \
    -d '{ "email": "MAIL@example.com", "pending_club_name": "Anime" }'
)

SESSION_TOKEN=$(jq <<< "$response" -r '.session_token')

jc POST /check-otp -d '{ "otp": "000000" }'

[[ $(jq <<< "$response" -r '.pending_club') = 'null' ]]

jc PATCH /onboardee-info -d '{ "name": "Jeff" }'
jc PATCH /onboardee-info -d '{ "date_of_birth": "1997-05-30" }'
c GET /search-locations?q=Syd
jc PATCH /onboardee-info -d '{ "location": "New York, New York, United States" }'
jc PATCH /onboardee-info -d '{ "gender": "Man" }'
jc PATCH /onboardee-info -d '{ "other_peoples_genders": ["Man", "Woman", "Other"] }'

response=$(c POST /finish-onboarding)

[[ $(jq <<< "$response" -r '.clubs[].search_preference') = true ]]
[[ $(jq <<< "$response" -r '.pending_club.name') = 'anime' ]]

[[ $(q "select count(*) from person_club where club_name = 'anime'") = 1 ]]
[[ $(q "select count(*) from search_preference where club_name = 'anime'") = 1 ]]

response=$(c POST /check-session-token)

[[ $(jq <<< "$response" -r '.clubs[].search_preference') = true ]]
[[ $(jq <<< "$response" -r '.pending_club.name') = 'anime' ]]

c POST /sign-out

response=$(
  jc \
    POST \
    /request-otp \
    -d '{ "email": "MAIL@example.com", "pending_club_name": "Manga" }'
)

SESSION_TOKEN=$(jq <<< "$response" -r '.session_token')

response=$(jc POST /check-otp -d '{ "otp": "000000" }')

[[ $(jq <<< "$response" -r '.clubs[].search_preference') = $'false\ntrue' ]]
[[ $(jq <<< "$response" -r '.pending_club.name') = 'manga' ]]

[[ $(q "select count(*) from person_club where club_name = 'manga'") = 1 ]]
[[ $(q "select count(*) from search_preference where club_name = 'manga'") = 1 ]]
