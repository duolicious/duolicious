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

../util/create-user.sh user1 0 0
../util/create-user.sh user2 0 0

response=$(jc POST /request-otp -d '{ "email": "user1@example.com" }')
SESSION_TOKEN=$(echo "$response" | jq -r '.session_token')
jc POST /check-otp -d '{ "otp": "000000" }'

test_set () {
  local field_name=$1
  local field_value=$2
  local check_empty=${3:-false}

  jc POST /search-filter -d '{ "'"$field_name"'": '"$field_value"' }'

  local new_field_value=$(
    set +x
    c GET /search-filters | jq ".${field_name}"
  )
  [[ "$(jq -cS . <<< "$new_field_value")" == "$(jq -cS . <<< "$field_value")" ]]

  if "$check_empty"
  then
    ! jc POST /search-filter -d '{ "'"$field_name"'": [] }' || exit 1
  fi
}

test_get_search_filter_questions () {
  q "delete from search_preference_answer"

  jc POST /search-filter-answer -d '{
    "question_id": 555,
    "answer": true,
    "accept_unanswered": false
  }'

  local actual_response=$(c GET '/search-filter-questions?q=a+partner&n=3&o=1')
  local expected_response=$(cat << EOF
    [
      {
        "accept_unanswered": true,
        "answer": null,
        "question": "Are you looking for a partner to marry?",
        "question_id": 45,
        "topic": "Interpersonal"
      },
      {
        "accept_unanswered": false,
        "answer": true,
        "question": "Do you want your partner to call you a pet name?",
        "question_id": 555,
        "topic": "Interpersonal"
      },
      {
        "accept_unanswered": true,
        "answer": null,
        "question": "Is it wrong to date a friend's ex-partner?",
        "question_id": 220,
        "topic": "Values"
      }
    ]
EOF
)

  [[
    "$(jq -cS <<< "$expected_response")" == \
    "$(jq -cS <<< "$actual_response")"
  ]]
}

test_set_search_filter_question() {
  q "delete from search_preference_answer"

  local answers=$(c GET /search-filters | jq .answer)

  [[ "$answers" = "[]" ]]

  assume_role user2
  local answers=$(
    jc POST /search-filter-answer -d '{
      "question_id": 1,
      "answer": false,
      "accept_unanswered": false
    }' | jq .answer
  )

  assume_role user1
  local answers=$(
    jc POST /search-filter-answer -d '{
      "question_id": 1,
      "answer": true,
      "accept_unanswered": false
    }' | jq .answer
  )

  local expected_answers=$(cat << EOF
    [
      {
        "accept_unanswered": false,
        "answer": true,
        "question": "Would you date a robot if they had a great personality?",
        "question_id": 1,
        "topic": "Interpersonal"
      }
    ]
EOF
)

  [[ "$(jq -cS <<< "$expected_answers")" == "$(jq -cS <<< "$answers")" ]]

  local answers=$(
    jc POST /search-filter-answer -d '{
      "question_id": 1,
      "answer": null,
      "accept_unanswered": false
    }' | jq .answer
  )

  [[ "$answers" = "[]" ]]

  for question_id in $(seq 1 20)
  do
    local json=$(cat << EOF
{
  "question_id": $question_id,
  "answer": false,
  "accept_unanswered": false
}
EOF
    )

    jc POST /search-filter-answer -d "$json"
  done

  [[ "$(c GET /search-filters | jq '.answer | length')" == "20" ]]

  local error=$(
    jc POST /search-filter-answer -d '{
      "question_id": 21,
      "answer": true,
      "accept_unanswered": false
    }' | jq -r .error
  )
  local expected_error="You can’t set more than 20 Q&A filters"

  [[ "$error" == "$expected_error" ]]
}

test_get_search_filter_questions
test_set_search_filter_question

test_set gender '["Other", "Trans man"]' true
test_set orientation '["Other", "Pansexual", "Unanswered"]' true
test_set ethnicity '["East Asian", "South Asian", "Southeast Asian"]' true
test_set age '{ "min_age": 42, "max_age": 56 }'
test_set furthest_distance 50
test_set furthest_distance null
test_set height '{"min_height_cm": 142, "max_height_cm": 171}'
test_set body_type '["Athletic", "Thin", "Unanswered"]' true
test_set has_a_profile_picture '["No", "Yes"]' true
test_set looking_for '["Friends", "Short-term dating", "Unanswered"]' true
test_set smoking '["No", "Unanswered"]' true
test_set drinking '["Never", "Unanswered"]' true
test_set drugs '["No", "Unanswered"]' true
test_set long_distance '["No", "Unanswered"]' true
test_set relationship_status '["Engaged", "Other", "Unanswered"]' true
test_set has_kids '["No", "Unanswered"]' true
test_set wants_kids '["Maybe", "No", "Unanswered"]' true
test_set exercise '["Never", "Unanswered"]' true
test_set religion '["Buddhist", "Unanswered"]' true
test_set star_sign '["Unanswered", "Virgo"]' true

test_set people_you_messaged '"No"'
test_set people_you_skipped '"Yes"'
