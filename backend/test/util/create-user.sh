#!/usr/bin/env bash

# Create and onboard a test user via the HTTP API.
# - Requests an OTP for the provided username or email and confirms it
# - Populates onboarding info (name, DOB, location, gender)
# - Answers a number of profile questions
# - Optionally uploads photos and an audio bio
#
# Usage:
#   ./create-user.sh <username_or_email> [num_questions=100] [num_photos=0] [do_add_audio=false]
# Examples:
#   ./create-user.sh alice 50 2 true
#   ./create-user.sh bob@example.com
#
# Requires:
# - Sourced test/util/setup.sh which provides jc, c, q, rand_image, rand_sound
# - Backend/API running and reachable by the test helpers
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -e

rand_bool_or_null () {
  local rand=$(($RANDOM % 3))

  if [[ "$rand" == 0 ]]
  then
    echo true
  elif [[ "$rand" == 1 ]]
  then
    echo false
  else
    echo null
  fi
}

rand_bool () {
  if [[ "$(($RANDOM % 2))" == 1 ]]
  then
    echo true
  else
    echo false
  fi
}

answer_questions () {
  for question_id in $(seq 1 $1)
  do
    local json=$(cat << EOF
{
  "question_id": $question_id,
  "answer": $(rand_bool_or_null),
  "public": $(rand_bool)
}
EOF
)
    jc POST /answer -d "$json"
  done
}

add_audio () {
  local snd=$(rand_sound)

  jc PATCH /profile-info \
    -d "{ \"base64_audio_file\": { \"base64\": \"${snd}\" } }"
}

main () {
  local username_or_email=$1
  local num_questions=${2:-100}
  local num_photos=${3:-0}
  local do_add_audio=${4:-false}

  if [[ "$username_or_email" == *@* ]]; then
    # Input is an email
    email="$username_or_email"
  else
    # Input is a username, append domain
    email="$username_or_email@example.com"
  fi

  local response=$(jc POST /request-otp -d '{ "email": "'"$email"'" }')

  if [[ "$username_or_email" == *@* ]]; then
    q "update duo_session set otp = '000000' where email = '$email'"
  fi

  SESSION_TOKEN=$(echo "$response" | jq -r '.session_token')

  local display_name=$(printf "$username_or_email" | tr _ ' ')

  jc POST /check-otp -d '{ "otp": "000000" }' > /dev/null
  jc PATCH /onboardee-info -d '{ "name": "'"$display_name"'" }'
  jc PATCH /onboardee-info -d '{ "date_of_birth": "'$( \
    date -d "-26 years -6 months" "+%Y-%m-%d")'" }'
  jc PATCH /onboardee-info -d '{ "location": "New York, New York, United States" }'
  jc PATCH /onboardee-info -d '{ "gender": "Other" }'
  jc PATCH /onboardee-info -d '{ "other_peoples_genders": ["Man", "Woman", "Agender", "Femboy", "Intersex", "Non-binary", "Transgender", "Trans woman", "Trans man", "Other"] }'
  c POST /finish-onboarding

  add_photos "${num_photos}"

  answer_questions "$num_questions"

  if [[ "${do_add_audio}" = true ]]
  then
    add_audio
  fi

  q "update person set has_gold = true where email = '$email'"

  echo "Created $username_or_email"
}

main "$@"
