#!/usr/bin/env bash

# The unauthenticated Q&A experience: web users (incl. mobile web) can answer
# questions before signing up. Those answers rank matches via /public-search
# and are saved to their profile once they authenticate (/request-otp -> sign
# in).

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

# `sign_in` lives in ../util/setup.sh.

reset_db () {
  q "delete from duo_session"
  q "delete from person"
  q "delete from onboardee"
  q "delete from undeleted_photo"
  q "update question set count_yes = 0, count_no = 0"
}

setup () {
  reset_db

  ../util/create-user.sh user1 0
  ../util/create-user.sh user2 0

  q "update person set public_profile = true, last_online_time = now()"
}

# An unauthenticated user can fetch questions, in ascending id order.
public_next_questions_works () {
  setup

  local page1=$(SESSION_TOKEN="" c GET '/public-next-questions?n=10&o=0')
  j_assert_length "$page1" 10

  local ascending=$(echo "$page1" | jq -r '[.[].id] == ([.[].id] | sort)')
  [[ "$ascending" == "true" ]]

  local page2=$(SESSION_TOKEN="" c GET '/public-next-questions?n=5&o=10')
  j_assert_length "$page2" 5

  # The pages don't overlap.
  local distinct=$(
    echo "$page1 $page2" | jq -s 'add | map(.id) | unique | length'
  )
  [[ "$distinct" -eq 15 ]]
}

# GET /public-search with an `answers` param works without auth, returns matches
# with a percentage, and respects the page size.
public_search_returns_matches () {
  setup

  local empty=$(jq -rn --arg a '[]' '$a|@uri')

  local response=$(SESSION_TOKEN="" c GET "/public-search?answers=$empty&n=10&o=0")

  j_assert_length "$response" 2

  # Every result carries a match percentage.
  local with_pct=$(echo "$response" | jq '[.[] | select(.match_percentage != null)] | length')
  [[ "$with_pct" -eq 2 ]]

  ! { SESSION_TOKEN="" c GET "/public-search?answers=$empty&n=11&o=0"; } || exit 1
}

# A prospect who answered a question the same way as the searcher should rank
# above one who answered it oppositely.
public_search_ranks_by_answers () {
  setup

  local qid=$(SESSION_TOKEN="" c GET '/public-next-questions?n=1&o=0' | jq -r '.[0].id')

  sign_in user1@example.com
  jc POST /answer -d '{ "question_id": '"$qid"', "answer": true,  "public": true }'

  sign_in user2@example.com
  jc POST /answer -d '{ "question_id": '"$qid"', "answer": false, "public": true }'

  q "update person set public_profile = true, last_online_time = now()"

  local answers=$(jq -rn --arg a \
    '[{ "question_id": '"$qid"', "answer": true, "public": true }]' '$a|@uri')

  local response=$(SESSION_TOKEN="" c GET "/public-search?answers=$answers&n=10&o=0")

  local m1=$(echo "$response" | jq -r '.[] | select(.name == "user1") | .match_percentage')
  local m2=$(echo "$response" | jq -r '.[] | select(.name == "user2") | .match_percentage')

  [[ "$m1" -gt "$m2" ]]
}

# Answers given before signing up are stashed at /request-otp and saved to the
# new profile when onboarding finishes.
answers_saved_on_onboarding () {
  reset_db

  local questions=$(SESSION_TOKEN="" c GET '/public-next-questions?n=2&o=0')
  local q1=$(echo "$questions" | jq -r '.[0].id')
  local q2=$(echo "$questions" | jq -r '.[1].id')

  local response=$(jc POST /request-otp -d '{
    "email": "newbie@example.com",
    "answers": [
      { "question_id": '"$q1"', "answer": true,  "public": true  },
      { "question_id": '"$q2"', "answer": false, "public": false }
    ]
  }')
  SESSION_TOKEN=$(echo "$response" | jq -r '.session_token')

  [[ "$(q "select jsonb_array_length(answers) from duo_session where answers is not null")" -eq 2 ]]

  jc POST /check-otp -d '{ "otp": "000000" }' > /dev/null

  # New user: nothing flushed yet (no person row until onboarding finishes).
  [[ "$(q "select count(*) from answer")" -eq 0 ]]

  jc PATCH /onboardee-info -d '{ "name": "Newbie" }'
  jc PATCH /onboardee-info -d '{ "date_of_birth": "1997-05-30" }'
  jc PATCH /onboardee-info -d '{ "location": "Sydney, New South Wales, Australia" }'
  jc PATCH /onboardee-info -d '{ "gender": "Man" }'
  jc PATCH /onboardee-info -d '{ "other_peoples_genders": ["Man", "Woman", "Other"] }'
  c POST /finish-onboarding > /dev/null

  local pid=$(q "select id from person where email = 'newbie@example.com'")

  [[ "$(q "select count(*) from answer where person_id = $pid")" -eq 2 ]]
  [[ "$(q "select answer  from answer where person_id = $pid and question_id = $q1")" == "t" ]]
  [[ "$(q "select answer  from answer where person_id = $pid and question_id = $q2")" == "f" ]]
  [[ "$(q "select public_ from answer where person_id = $pid and question_id = $q2")" == "f" ]]
  [[ "$(q "select count_answers from person where id = $pid")" -eq 2 ]]

  # The stash is cleared and the question stats were bumped. The yes/no
  # counts land via a one-second batcher, not in the flush transaction.
  [[ "$(q "select count(*) from duo_session where answers is not null")" -eq 0 ]]
  sleep 2
  [[ "$(q "select count_yes from question where id = $q1")" -eq 1 ]]
  [[ "$(q "select count_no  from question where id = $q2")" -eq 1 ]]
}

# An existing user's pre-sign-up answers overwrite their stored answers when
# they sign back in.
answers_overwrite_on_existing_signin () {
  setup

  local qid=$(SESSION_TOKEN="" c GET '/public-next-questions?n=1&o=0' | jq -r '.[0].id')
  local pid=$(q "select id from person where email = 'user1@example.com'")

  sign_in user1@example.com
  jc POST /answer -d '{ "question_id": '"$qid"', "answer": true, "public": true }'
  c POST /sign-out > /dev/null

  [[ "$(q "select answer from answer where person_id = $pid and question_id = $qid")" == "t" ]]

  local response=$(jc POST /request-otp -d '{
    "email": "user1@example.com",
    "answers": [{ "question_id": '"$qid"', "answer": false, "public": false }]
  }')
  SESSION_TOKEN=$(echo "$response" | jq -r '.session_token')

  [[ "$(q "select jsonb_array_length(answers) from duo_session where answers is not null")" -eq 1 ]]

  jc POST /check-otp -d '{ "otp": "000000" }' > /dev/null

  # Existing user signs in here, so the answer is overwritten immediately.
  [[ "$(q "select answer  from answer where person_id = $pid and question_id = $qid")" == "f" ]]
  [[ "$(q "select public_ from answer where person_id = $pid and question_id = $qid")" == "f" ]]
  [[ "$(q "select count(*) from duo_session where answers is not null")" -eq 0 ]]
}

public_next_questions_works
public_search_returns_matches
public_search_ranks_by_answers
answers_saved_on_onboarding
answers_overwrite_on_existing_signin
