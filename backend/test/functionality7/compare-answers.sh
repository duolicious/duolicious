#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

offset_file=/tmp/$RANDOM.offset
trap "rm $offset_file" EXIT

set -xe

setup () {
  q "delete from duo_session"
  q "delete from person"
  q "delete from onboardee"
  q "delete from undeleted_photo"

  ../util/create-user.sh searcher 0
  ../util/create-user.sh prospect 0

  local response=$(jc POST /request-otp -d '{ "email": "searcher@example.com" }')
  SEARCHER_SESSION_TOKEN=$(echo "$response" | jq -r '.session_token')
  SESSION_TOKEN=$SEARCHER_SESSION_TOKEN
  jc POST /check-otp -d '{ "otp": "000000" }'

  local response=$(jc POST /request-otp -d '{ "email": "prospect@example.com" }')
  PROSPECT_SESSION_TOKEN=$(echo "$response" | jq -r '.session_token')
  SESSION_TOKEN=$PROSPECT_SESSION_TOKEN
  jc POST /check-otp -d '{ "otp": "000000" }'
}

next_question_id () {
  local topic=$1
  local question_id_offset=$(cat "$offset_file" 2>/dev/null || echo "0")

  q "
  select id
  from question
  where topic = '$topic'
  order by id
  limit 1
  offset $question_id_offset
  "

  echo "$((question_id_offset+1))" > "$offset_file"
}

rand_bool () {
  if [[ "$(($RANDOM % 2))" == 1 ]]
  then
    echo true
  else
    echo false
  fi
}

negate () {
  if [[ "$1" = true ]]
  then
    echo false
  else
    echo true
  fi
}

insert_dummy_data () {
  for agreement in agree disagree unanswered ; do
    for topic in Values Sex Interpersonal Other ; do
      for prospect_answer in true false ; do
        for public in true false ; do
          local question_id=$(next_question_id "$topic")

          if [[ "$agreement" = agree ]]
          then
            local searcher_answer=$prospect_answer
          elif [[ "$agreement" = disagree ]]
          then
            local searcher_answer=$(negate "$prospect_answer")
          elif [[ "$agreement" = unanswered ]]
          then
            local searcher_answer=null
          else
            echo "This shouldn't happen"
            return 1
          fi

          local prospect_json=$(cat << EOF
{
  "question_id": $question_id,
  "answer": $prospect_answer,
  "public": $public
}
EOF
)

          local searcher_json=$(cat << EOF
{
  "question_id": $question_id,
  "answer": $searcher_answer,
  "public": $(rand_bool)
}
EOF
)

          SESSION_TOKEN=$PROSPECT_SESSION_TOKEN
          jc POST /answer -d "$prospect_json"

          SESSION_TOKEN=$SEARCHER_SESSION_TOKEN
          jc POST /answer -d "$searcher_json"
        done
      done
    done
  done
}

assert_jq () {
  echo "$1" | jq "all(.[]; $2)" | grep true >/dev/null
}

assertions () {
  SESSION_TOKEN=$SEARCHER_SESSION_TOKEN
  prospect_id=$(q "select id from person where email = 'prospect@example.com'")

  for agreement in agree disagree unanswered ; do
    for topic in values sex interpersonal other ; do
      response=$(c GET "/compare-answers/${prospect_id}?agreement=${agreement}&topic=${topic}")

      j_assert_length "$response" 2
    done
  done

  for agreement in agree disagree unanswered ; do
    response=$(c GET "/compare-answers/${prospect_id}?agreement=${agreement}&topic=all")

    j_assert_length "$response" 8
  done

  for topic in values sex interpersonal other ; do
    response=$(c GET "/compare-answers/${prospect_id}?agreement=all&topic=${topic}")

    j_assert_length "$response" 6
  done

  for agreement in agree disagree unanswered ; do
    for topic in values sex interpersonal other ; do
      response=$(c GET "/compare-answers/${prospect_id}?agreement=${agreement}&topic=${topic}")

      if [[ "$agreement" = agree ]]; then
        assert_jq "$response" '.person_answer   != null'
        assert_jq "$response" '.prospect_answer != null'

        assert_jq "$response" '.person_answer == .prospect_answer'
      elif [[ "$agreement" = disagree ]]; then
        assert_jq "$response" '.person_answer   != null'
        assert_jq "$response" '.prospect_answer != null'

        assert_jq "$response" '.person_answer != .prospect_answer'
      elif [[ "$agreement" = unanswered ]]; then
        assert_jq "$response" '.person_answer   == null'
        assert_jq "$response" '.prospect_answer != null'
      else
        echo 'should never happen'
        return 1
      fi
    done
  done
}

main () {
  setup

  insert_dummy_data

  assertions
}

main
