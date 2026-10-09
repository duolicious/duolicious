#!/usr/bin/env bash

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$script_dir"

source ../util/setup.sh

set -xe

reset_db () {
  q "delete from person"
  q "delete from person_club"
  q "delete from club"
}

members () {
  c GET "/club-card?name=$1" | jq -c .members
}

everyone_sees_the_best_25_members () {
  echo 'Club cards list the best 25 visible members, whether or not you have joined'

  reset_db

  ../util/create-user.sh searcher 0 0
  for i in $(seq 1 26); do
    ../util/create-user.sh "member$i" 0 0
    assume_role "member$i"
    jc POST /join-club -d '{ "name": "chess" }'
  done

  assume_role searcher

  [[ "$(members chess | jq length)" == "25" ]]

  q "update person set hide_me_from_strangers = true where name in ('member1', 'member2')"

  [[ "$(members chess | jq length)" == "24" ]]

  jc POST /join-club -d '{ "name": "chess" }'

  local search_cache_rows=$(q "select count(*) from search_cache")
  local club_preference=$(q "select club_name from search_preference where person_id = (select id from person where name = 'searcher')")

  q "update person set hide_me_from_strangers = false"

  [[ "$(members chess | jq length)" == "25" ]]

  [[ "$(q "select count(*) from search_cache")" == "$search_cache_rows" ]]
  [[ "$(q "select club_name from search_preference where person_id = (select id from person where name = 'searcher')")" == "$club_preference" ]]
}

club_card_shows_count_and_related_clubs () {
  echo 'A club card has a member count and related clubs, even for new clubs'

  reset_db

  ../util/create-user.sh user1 0 0

  q "insert into club (name, count_members, embedding) values
    ('knitting', 0, l2_normalize(array_fill(1, array[64])::vector(64))),
    ('crochet', 60, l2_normalize(array_fill(1, array[64])::vector(64))),
    ('weaving', 70, l2_normalize((array_fill(1, array[32]) || array_fill(-1, array[32]))::vector(64))),
    ('tiny', 3, l2_normalize(array_fill(1, array[64])::vector(64)))"

  assume_role user1

  result=$(c GET '/club-card?name=knitting')
  [[ "$(jq -r .count_members <<< "$result")" == "0" ]]
  [[ "$(jq -c '[.related_clubs[].name]' <<< "$result")" == '["crochet","weaving"]' ]]

  result=$(c GET '/club-card?name=leeds%20night%20swimmers')
  [[ "$(jq -cS . <<< "$result")" == '{"count_members":0,"members":[],"related_clubs":[]}' ]]

  ! c GET '/club-card?name=' || exit 1
}

suggested_clubs_are_popular_clubs_you_have_not_joined () {
  echo 'An empty club search suggests popular clubs you have not joined'

  reset_db

  ../util/create-user.sh user1 0 0

  q "insert into club (name, count_members) values
    ('crochet', 60), ('weaving', 900), ('quilting', 80), ('tiny', 3)"

  assume_role user1

  [[ "$(c GET '/search-clubs?q=' | jq -c '[.[].name]')" == '["weaving","quilting","crochet"]' ]]

  jc POST /join-club -d '{ "name": "crochet" }'

  [[ "$(c GET '/search-clubs?q=' | jq -c '[.[].name]')" == '["weaving","quilting"]' ]]
}

joining_or_leaving_returns_suggestions_from_ten_clubs () {
  echo 'Joining or leaving a club returns suggestions once you are in 10 clubs'

  reset_db

  ../util/create-user.sh user1 0 0

  q "insert into club (name, count_members) values ('weaving', 900)"

  assume_role user1

  for i in $(seq 1 9)
  do
    [[ "$(jc POST /join-club -d "{ \"name\": \"club$i\" }" | jq -c .)" == \
      '{"suggested_clubs":null}' ]]
  done

  [[ "$(jc POST /join-club -d '{ "name": "club10" }' | jq -c .)" == \
    '{"suggested_clubs":[{"count_members":900,"name":"weaving"}]}' ]]

  [[ "$(jc POST /leave-club -d '{ "name": "club10" }' | jq -c .)" == \
    '{"suggested_clubs":null}' ]]
}

everyone_sees_the_best_25_members
club_card_shows_count_and_related_clubs
suggested_clubs_are_popular_clubs_you_have_not_joined
joining_or_leaving_returns_suggestions_from_ten_clubs
